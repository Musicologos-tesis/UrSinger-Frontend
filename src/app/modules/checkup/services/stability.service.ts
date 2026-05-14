import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AudioPitchService } from './audio-pitch.service';
import { CalibrationService } from './calibration.service';
import { MetricsService } from './metrics.service';
import { VoiceDetectionService } from '../../../services/voice-detection.service';

export enum StabilityPhase {
  Idle = 'idle',
  Recording = 'recording',
  Complete = 'complete',
  Error = 'error',
}

interface StabilitySample {
  midi: number;
  rms: number;
  confidence: number;
  frequency: number;
  timestamp: number;
}

interface VocalSegment {
  samples: StabilitySample[];
  startTime: number;
  endTime: number;
  durationSec: number;
}

export interface StabilityMetrics {
  meanRmsDb: number | null;
  rmsConsistency: number | null;
  dynamicRangeDb: number | null;
  durationSec: number | null;
  precisionCents: number | null;
  stabilityCents: number | null;
  attackLatencyMs: number | null;
}


@Injectable({ providedIn: 'root' })
export class StabilityService {
  private pitch = inject(AudioPitchService);
  private calibration = inject(CalibrationService);
  private metricsService = inject(MetricsService);
  private voiceDetection = inject(VoiceDetectionService);

  private readonly CAPTURE_INTERVAL_MS = 100;
  private readonly MIN_CAPTURED_SAMPLES = 15;
  private readonly SEGMENT_MAX_GAP_MS = 300;
  private readonly MIN_SEGMENT_SAMPLES = 5;
  private readonly MIN_CORRECT_SEGMENT_SAMPLES = 2;

  readonly phase$ = new BehaviorSubject<StabilityPhase>(StabilityPhase.Idle);
  readonly currentMidi$ = new BehaviorSubject<number>(0);
  readonly currentRms$ = new BehaviorSubject<number>(-90);
  readonly currentConfidence$ = new BehaviorSubject<number>(0);
  readonly currentNote$ = new BehaviorSubject<string>('-');
  readonly samplesCount$ = new BehaviorSubject<number>(0);
  readonly progress$ = new BehaviorSubject<number>(0); // 0–1
  readonly errorMessage$ = new BehaviorSubject<string | null>(null);

  private samples: StabilitySample[] = [];
  private captureIntervalId?: number;
  private startTime = 0;
  private targetDurationSec = 10;
  private targetMidi: number | null = null;
  private readonly TARGET_TOLERANCE_CENTS = 50;
  private readonly ATTACK_LATENCY_LIMIT_MS = 500;
  private readonly STABILITY_CENTS_LIMIT = 50;
  private readonly ONSET_BLOCK_FRAMES = 3; // ~300ms de ataque a ignorar
  private attackLatencyCandidatesMs: number[] = [];
  private currentAttackStartMs: number | null = null;
  private attackCapturedInCurrentUtterance = false;
  private hasReachedTargetInCurrentUtterance = false;
  private wasVocalActive = false;
  // precisionCents: desviación media de la voz respecto al target (excluye ataque)
  private onsetBlockRemaining: number = 0;
  private precisionMidiBuffer: number[] = [];
  private precisionSegmentMeans: number[] = [];
  // stabilityCents: variación (std dev) desde que se alcanza la nota objetivo
  private stabilityMidiBuffer: number[] = [];
  private stabilitySegmentStdevs: number[] = [];
  private minVoiceRmsDb: number = -40;

  lastMetrics?: StabilityMetrics;

  /**
   * Inicia la captura para la prueba de estabilidad
   */
  async start(analyser: AnalyserNode, durationSec = 10, targetMidi?: number): Promise<void> {
    // Asegurar sesión válida
    const sessionId = this.calibration.getSessionId();
    if (!sessionId) {
      throw new Error('No hay sessionId. Completa la calibración primero.');
    }

    this.targetDurationSec = durationSec;
    this.targetMidi = Number.isFinite(targetMidi) && (targetMidi as number) > 0
      ? Math.round(targetMidi as number)
      : null;
    this.samples = [];
    this.resetTrackingState();
    this.progress$.next(0);
    this.errorMessage$.next(null);
    this.lastMetrics = undefined;

    // Inicializar CREPE
    await this.pitch.initialize(analyser);

    // Aplicar calibración de ruido/nivel como en VocalRange
    const noiseFloorDb = this.calibration.getNoiseFloorDbfs();
    const avgRmsDb = this.calibration.getAverageRmsDb();
    const voiceProfile = this.voiceDetection.readVoiceProfile();
    this.pitch.calibrateFromMetrics(avgRmsDb, noiseFloorDb);
    this.minVoiceRmsDb = this.voiceDetection.buildMinVoiceRmsDb(
      noiseFloorDb,
      avgRmsDb,
      voiceProfile
    );

    this.startTime = performance.now();
    this.phase$.next(StabilityPhase.Recording);

    this.startCaptureLoop();
    this.log('stability_start', { durationSec, noiseFloorDb, avgRmsDb });
  }

  /**
   * Detiene la captura y calcula métricas
   */
  stopAndComputeMetrics(): StabilityMetrics | null {
    this.stopCaptureLoop();
    this.finalizeActiveUtterance();

    if (!this.samples.length) {
      this.phase$.next(StabilityPhase.Error);
      this.errorMessage$.next(
        'No pudimos detectar una nota estable. Intenta sostener una vocal "ahh" en un tono cómodo durante unos segundos.'
      );
      this.log('no_samples');
      return null;
    }

    if (this.samples.length < this.MIN_CAPTURED_SAMPLES) {
      this.phase$.next(StabilityPhase.Error);
      this.errorMessage$.next(
        'La señal capturada fue muy débil o inestable. Intenta cantar un poco más fuerte o acercarte al micrófono.'
      );
      this.log('too_few_samples', { count: this.samples.length });
      return null;
    }

    const metrics = this.calculateMetrics();
    this.lastMetrics = metrics;

    // Guardar métricas parciales en localStorage
    this.metricsService.savePartialMetrics('stability', {
      precisionCents: metrics.precisionCents ?? undefined,
      stabilityCents: metrics.stabilityCents ?? undefined,
      attackLatencyMs: metrics.attackLatencyMs ?? undefined,
      meanRmsDb: metrics.meanRmsDb ?? undefined,
      rmsConsistency: metrics.rmsConsistency ?? undefined,
      dynamicRangeDb: metrics.dynamicRangeDb ?? undefined,
      durationSec: metrics.durationSec ?? undefined
    });

    this.log('metrics_computed', { metrics });
    console.log('[stability] métricas guardadas en localStorage');

    this.phase$.next(StabilityPhase.Complete);
    return metrics;
  }

  reset() {
    this.stopCaptureLoop();
    this.samples = [];
    this.phase$.next(StabilityPhase.Idle);
    this.progress$.next(0);
    this.currentMidi$.next(0);
    this.currentRms$.next(-90);
    this.currentConfidence$.next(0);
    this.currentNote$.next('-');
    this.samplesCount$.next(0);
    this.lastMetrics = undefined;
    this.errorMessage$.next(null);
    this.targetMidi = null;
    this.resetTrackingState();
  }

  /**
   * Reintentar desde la UI
   */
  retry() {
    this.reset();
  }

  // ─────────────────────────────
  //        CAPTURA CONTINUA
  // ─────────────────────────────

  private startCaptureLoop() {
    this.stopCaptureLoop();

    this.captureIntervalId = window.setInterval(async () => {
      if (this.phase$.value !== StabilityPhase.Recording) {
        this.stopCaptureLoop();
        return;
      }

      const { frequency, confidence, midiNote } = await this.pitch.detectPitch();
      const rms = this.pitch.calculateRMS();

      this.currentRms$.next(rms);
      this.currentConfidence$.next(confidence);

      const isVocalSignal = this.voiceDetection.isValidVocalSample(
        { frequency, confidence, midiNote, rms },
        { minVoiceRmsDb: this.minVoiceRmsDb }
      );

      // Igual que en rango vocal: solo mostrar nota/midi cuando la señal es vocal válida.
      if (isVocalSignal) {
        this.currentMidi$.next(midiNote);
        this.currentNote$.next(this.pitch.midiToNoteName(midiNote));
      } else {
        this.currentMidi$.next(0);
        this.currentNote$.next('-');
      }

      this.updateAttackLatencyTracking(isVocalSignal, midiNote, performance.now());

      // Log deshabilitado: mantener captura limpia

      // Capturar muestra si hay señal vocal
      if (isVocalSignal) {
        this.samples.push({
          midi: midiNote,
          rms,
          confidence,
          frequency,
          timestamp: performance.now(),
        });
        this.samplesCount$.next(this.samples.length);
      }

      // Progreso UI
      const elapsedSec = (performance.now() - this.startTime) / 1000;
      const progress = elapsedSec / this.targetDurationSec;
      this.progress$.next(Math.min(1, progress));
    }, this.CAPTURE_INTERVAL_MS);
  }

  private resetTrackingState(): void {
    this.attackLatencyCandidatesMs = [];
    this.currentAttackStartMs = null;
    this.attackCapturedInCurrentUtterance = false;
    this.hasReachedTargetInCurrentUtterance = false;
    this.wasVocalActive = false;
    this.onsetBlockRemaining = 0;
    this.precisionMidiBuffer = [];
    this.precisionSegmentMeans = [];
    this.stabilityMidiBuffer = [];
    this.stabilitySegmentStdevs = [];
  }

  private stopCaptureLoop() {
    if (this.captureIntervalId) {
      clearInterval(this.captureIntervalId);
      this.captureIntervalId = undefined;
    }
  }

  // ─────────────────────────────
  //        CÁLCULO MÉTRICAS
  // ─────────────────────────────

  private calculateMetrics(): StabilityMetrics {
    // PASO 1: Segmentar las muestras en fragmentos vocales continuos
    const segments = this.segmentVocalPhrases(this.samples);
    
    console.log('[Stability] Segmentos vocales detectados:', segments.length);
    segments.forEach((seg, idx) => {
      console.log(`  Segmento ${idx + 1}: ${seg.samples.length} muestras, ${seg.durationSec.toFixed(2)}s`);
    });

    if (segments.length === 0) {
      return {
        meanRmsDb: null,
        rmsConsistency: null,
        dynamicRangeDb: null,
        durationSec: null,
        precisionCents: null,
        stabilityCents: null,
        attackLatencyMs: null,
      };
    }

    // PASO 2: Calcular métricas para cada segmento
    const segmentMetrics = segments.map(seg => this.calculateSegmentMetrics(seg));

    // PASO 3: Promediar métricas de todos los segmentos
    const validMeanRms = segmentMetrics.map(m => m.meanRmsDb).filter(v => v !== null) as number[];
    const validRmsConsistency = segmentMetrics.map(m => m.rmsConsistency).filter(v => v !== null) as number[];
    const validDynamicRange = segmentMetrics.map(m => m.dynamicRangeDb).filter(v => v !== null) as number[];
    const validStability = segmentMetrics.map(m => m.stabilityCents).filter(v => v !== null) as number[];

    // durationSec = el segmento MÁS LARGO con nota objetivo correcta
    // (si no hay target/captura válida, usar el mayor segmento vocal).
    const longestSegment = segments.reduce((max, seg) => 
      seg.durationSec > max.durationSec ? seg : max
    , segments[0]);
    const longestCorrectDurationSec = this.calculateLongestCorrectDurationSec();
    const durationForPayload = longestCorrectDurationSec ?? longestSegment.durationSec;
    const attackLatencyMs = this.calculateAttackLatencyMs();

    // precisionCents: media de desviaciones post-ataque por emisión (cap 600)
    const precisionCentsRaw = this.precisionSegmentMeans.length > 0
      ? this.mean(this.precisionSegmentMeans)
      : null;
    const precisionCents = precisionCentsRaw !== null ? Math.min(precisionCentsRaw, 600) : null;

    // stabilityCents: media de std dev por emisión (solo cuando se alcanzó la nota objetivo)
    const stabilityCents = this.stabilitySegmentStdevs.length > 0
      ? this.mean(this.stabilitySegmentStdevs)
      : 200;

    return {
      meanRmsDb: validMeanRms.length > 0 ? this.mean(validMeanRms) : null,
      rmsConsistency: validRmsConsistency.length > 0 ? this.mean(validRmsConsistency) : null,
      dynamicRangeDb: validDynamicRange.length > 0 ? this.mean(validDynamicRange) : null,
      durationSec: durationForPayload,
      precisionCents,
      stabilityCents,
      attackLatencyMs,
    };
  }

  private finalizeActiveUtterance(): void {
    if (!this.wasVocalActive) return;

    if (this.targetMidi && this.precisionMidiBuffer.length > 0) {
      const meanDev = this.mean(
        this.precisionMidiBuffer.map(m => Math.abs((m - this.targetMidi!) * 100))
      );
      if (meanDev !== null) this.precisionSegmentMeans.push(meanDev);
    }

    if (this.hasReachedTargetInCurrentUtterance && this.stabilityMidiBuffer.length >= 2) {
      const stdev = this.std(this.stabilityMidiBuffer);
      if (stdev !== null) this.stabilitySegmentStdevs.push(stdev * 100);
    }

    this.precisionMidiBuffer = [];
    this.stabilityMidiBuffer = [];
  }

  private updateAttackLatencyTracking(isVocalSignal: boolean, midiNote: number, timestampMs: number): void {
    const isOnset = isVocalSignal && !this.wasVocalActive;
    const isEnd   = !isVocalSignal && this.wasVocalActive;

    // ── Inicio de emisión ──────────────────────────────────────────────
    if (isOnset) {
      this.currentAttackStartMs = timestampMs;
      this.attackCapturedInCurrentUtterance = false;
      this.hasReachedTargetInCurrentUtterance = false;
      this.onsetBlockRemaining = this.ONSET_BLOCK_FRAMES;
      this.precisionMidiBuffer = [];
      this.stabilityMidiBuffer = [];
    }

    // ── Fin de emisión ─────────────────────────────────────────────────
    if (isEnd) {
      // precisionCents: media de desviaciones de todos los frames post-ataque
      if (this.targetMidi && this.precisionMidiBuffer.length > 0) {
        const meanDev = this.mean(
          this.precisionMidiBuffer.map(m => Math.abs((m - this.targetMidi!) * 100))
        );
        if (meanDev !== null) this.precisionSegmentMeans.push(meanDev);
      }

      // stabilityCents: std dev del midi desde que se alcanzó la nota objetivo
      if (this.hasReachedTargetInCurrentUtterance && this.stabilityMidiBuffer.length >= 2) {
        const stdev = this.std(this.stabilityMidiBuffer);
        if (stdev !== null) this.stabilitySegmentStdevs.push(stdev * 100); // semitones → cents
      }

      this.precisionMidiBuffer = [];
      this.stabilityMidiBuffer = [];
      this.currentAttackStartMs = null;
      this.attackCapturedInCurrentUtterance = false;
      this.hasReachedTargetInCurrentUtterance = false;
    }

    // ── Frame activo ───────────────────────────────────────────────────
    if (isVocalSignal && this.targetMidi) {
      // Attack latency
      if (!this.attackCapturedInCurrentUtterance && this.currentAttackStartMs !== null && this.isTargetNote(midiNote)) {
        this.attackLatencyCandidatesMs.push(Math.max(0, timestampMs - this.currentAttackStartMs));
        this.attackCapturedInCurrentUtterance = true;
      }

      // precisionCents: acumular post-ataque
      if (this.onsetBlockRemaining > 0) {
        this.onsetBlockRemaining--;
      } else {
        this.precisionMidiBuffer.push(midiNote);
      }

      // stabilityCents: acumular desde que se llega al target
      if (!this.hasReachedTargetInCurrentUtterance && this.isTargetNote(midiNote)) {
        this.hasReachedTargetInCurrentUtterance = true;
      }
      if (this.hasReachedTargetInCurrentUtterance) {
        this.stabilityMidiBuffer.push(midiNote);
      }
    }

    this.wasVocalActive = isVocalSignal;
  }

  private isTargetNote(midi: number): boolean {
    if (!this.targetMidi || midi <= 0) {
      return false;
    }

    return Math.abs((midi - this.targetMidi) * 100) <= this.TARGET_TOLERANCE_CENTS;
  }

  private calculateAttackLatencyMs(): number {
    const validLatencies = this.attackLatencyCandidatesMs.filter(ms => ms < this.ATTACK_LATENCY_LIMIT_MS);

    if (!validLatencies.length) {
      return this.ATTACK_LATENCY_LIMIT_MS;
    }

    return Math.round(validLatencies.reduce((sum, ms) => sum + ms, 0) / validLatencies.length);
  }

  private calculateLongestCorrectDurationSec(): number | null {
    if (!this.targetMidi || this.samples.length === 0) {
      return null;
    }

    const correctSamples = this.samples.filter(sample =>
      Math.abs((sample.midi - this.targetMidi!) * 100) <= this.TARGET_TOLERANCE_CENTS
    );

    const correctSegments = this.segmentByGap(correctSamples, this.SEGMENT_MAX_GAP_MS, this.MIN_CORRECT_SEGMENT_SAMPLES);
    if (!correctSegments.length) {
      return 0;
    }

    const durations = correctSegments.map(seg => seg.durationSec);
    this.log('correct_segments_sec', durations.map(d => d.toFixed(2)));

    return Math.max(...durations);
  }

  /**
   * Segmenta las muestras en fragmentos vocales continuos
   * Un fragmento se rompe si hay un gap > 300ms entre muestras
   */
  private segmentVocalPhrases(samples: StabilitySample[]): VocalSegment[] {
    return this.segmentByGap(samples, this.SEGMENT_MAX_GAP_MS, this.MIN_SEGMENT_SAMPLES);
  }

  private segmentByGap(samples: StabilitySample[], maxGapMs: number, minSamples: number): VocalSegment[] {
    if (samples.length === 0) return [];

    const segments: VocalSegment[] = [];
    let currentSegment: StabilitySample[] = [samples[0]];

    for (let i = 1; i < samples.length; i++) {
      const gap = samples[i].timestamp - samples[i - 1].timestamp;

      if (gap > maxGapMs) {
        if (currentSegment.length >= minSamples) {
          segments.push(this.createSegment(currentSegment));
        }
        currentSegment = [samples[i]];
      } else {
        currentSegment.push(samples[i]);
      }
    }

    if (currentSegment.length >= minSamples) {
      segments.push(this.createSegment(currentSegment));
    }

    return segments;
  }

  private createSegment(samples: StabilitySample[]): VocalSegment {
    const startTime = samples[0].timestamp;
    const endTime = samples[samples.length - 1].timestamp;
    return {
      samples,
      startTime,
      endTime,
      durationSec: (endTime - startTime) / 1000,
    };
  }

  /**
   * Calcula métricas para un segmento vocal individual
   */
  private calculateSegmentMetrics(segment: VocalSegment): StabilityMetrics {
    const { samples } = segment;
    
    const rmsValues = samples.map(s => s.rms);
    const meanRmsDb = this.mean(rmsValues);
    const rmsStd = this.std(rmsValues);
    const dynamicRangeDb = rmsValues.length > 0 
      ? Math.max(...rmsValues) - Math.min(...rmsValues) 
      : null;

    const rmsConsistency = meanRmsDb !== null && rmsStd !== null
      ? Math.max(0, Math.min(1, 1 - rmsStd / (Math.abs(meanRmsDb) + 1e-6)))
      : null;

    const midis = samples.map(s => s.midi);
    const centerMidi = this.median(midis);

    let stabilityCents: number | null = null;

    if (centerMidi !== null) {
      const errorsCents = midis.map(m => (m - centerMidi) * 100);
      stabilityCents = this.std(errorsCents);
    }

    return {
      meanRmsDb,
      rmsConsistency,
      dynamicRangeDb,
      durationSec: segment.durationSec,
      precisionCents: null,
      stabilityCents,
      attackLatencyMs: null,
    };
  }

  // ─────────────────────────────
  //        HELPERS
  // ─────────────────────────────

  private mean(values: number[]): number | null {
    if (!values.length) return null;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
  }

  private std(values: number[]): number | null {
    if (values.length < 2) return null;
    const m = this.mean(values)!;
    const variance =
      values.reduce((sum, v) => sum + (v - m) * (v - m), 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  private median(values: number[]): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private log(event: string, data?: any) {
    console.log('[stability]', event, data || '');
  }
}
