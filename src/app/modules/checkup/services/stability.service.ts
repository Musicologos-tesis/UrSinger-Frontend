import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AudioPitchService } from './audio-pitch.service';
import { CalibrationService } from './calibration.service';
import { environment } from '../../../../environments/environment.development';

export enum StabilityPhase {
  Idle = 'idle',
  Recording = 'recording',
  Complete = 'complete',
  Error = 'error',
}

interface StabilitySample {
  midi: number;
  rms: number;
  timestamp: number;
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

/**
 * MISMO contrato que en vocal-range.service.ts
 * (si quieres, luego lo mueves a un archivo compartido)
 */
export interface MetricsData {
  meanRmsDb: number | null;
  rmsConsistency: number | null;
  dynamicRangeDb: number | null;
  durationSec: number | null;

  precisionCents: number | null;
  stabilityCents: number | null;

  rangeMinMidi: number | null;
  rangeMaxMidi: number | null;
  rangeSpanSemitones: number | null;

  vibratoRateHz: number | null;
  vibratoDepthCents: number | null;

  attackLatencyMs: number | null;
}

export interface ExerciseMetricsPayload {
  sessionId: string;
  exerciseId: string;
  attemptNumber: number;
  metricsData: MetricsData;
}

@Injectable({ providedIn: 'root' })
export class StabilityService {
  private pitch = inject(AudioPitchService);
  private calibration = inject(CalibrationService);

  readonly phase$ = new BehaviorSubject<StabilityPhase>(StabilityPhase.Idle);
  readonly currentMidi$ = new BehaviorSubject<number>(0);
  readonly currentRms$ = new BehaviorSubject<number>(-90);
  readonly progress$ = new BehaviorSubject<number>(0); // 0–1
  readonly errorMessage$ = new BehaviorSubject<string | null>(null);

  private samples: StabilitySample[] = [];
  private captureIntervalId?: number;
  private startTime = 0;
  private targetDurationSec = 10;
  private noiseFloorDb: number = -90;

  lastMetrics?: StabilityMetrics;
  lastPayload?: ExerciseMetricsPayload;

  /**
   * Inicia la captura para la prueba de estabilidad
   */
  async start(analyser: AnalyserNode, durationSec = 10): Promise<void> {
    // Asegurar sesión válida
    const sessionId = this.calibration.getSessionId();
    if (!sessionId) {
      throw new Error('No hay sessionId. Completa la calibración primero.');
    }

    this.targetDurationSec = durationSec;
    this.samples = [];
    this.progress$.next(0);
    this.errorMessage$.next(null);
    this.lastMetrics = undefined;
    this.lastPayload = undefined;

    // Inicializar CREPE
    await this.pitch.initialize(analyser);

    // Aplicar calibración de ruido/nivel como en VocalRange
    const noiseFloorDb = this.calibration.getNoiseFloorDbfs();
    const avgRmsDb = this.calibration.getAverageRmsDb();
    this.pitch.calibrateFromMetrics(avgRmsDb, noiseFloorDb);
    this.noiseFloorDb = noiseFloorDb;

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

    if (!this.samples.length) {
      this.phase$.next(StabilityPhase.Error);
      this.errorMessage$.next(
        'No pudimos detectar una nota estable. Intenta sostener una vocal "ahh" en un tono cómodo durante unos segundos.'
      );
      this.log('no_samples');
      return null;
    }

    if (this.samples.length < 15) {
      this.phase$.next(StabilityPhase.Error);
      this.errorMessage$.next(
        'La señal capturada fue muy débil o inestable. Intenta cantar un poco más fuerte o acercarte al micrófono.'
      );
      this.log('too_few_samples', { count: this.samples.length });
      return null;
    }

    const metrics = this.calculateMetrics();
    this.lastMetrics = metrics;

    // Construir payload estándar para el backend / modelo
    const payload = this.buildExercisePayload(metrics);
    this.lastPayload = payload;
    this.log('metrics_computed', { metrics, payload });

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
    this.lastMetrics = undefined;
    this.lastPayload = undefined;
    this.errorMessage$.next(null);
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

      this.currentMidi$.next(midiNote);
      this.currentRms$.next(rms);

      // Filtro: señal vocal real (sobre ruido y con confianza suficiente)
      const isVocalSignal = rms > (this.noiseFloorDb + 6);

      // Graves necesitan menos confianza que notas más agudas
      const confidenceThreshold = frequency < 150 ? 0.25 : 0.4;

      if (midiNote > 0 && confidence >= confidenceThreshold && isVocalSignal) {
        this.samples.push({
          midi: midiNote,
          rms,
          timestamp: performance.now(),
        });
      }

      // Progreso UI
      const elapsedSec = (performance.now() - this.startTime) / 1000;
      const progress = elapsedSec / this.targetDurationSec;
      this.progress$.next(Math.min(1, progress));
    }, 100);
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
    const durationSec =
      this.samples.length > 1
        ? (this.samples[this.samples.length - 1].timestamp - this.samples[0].timestamp) / 1000
        : (performance.now() - this.startTime) / 1000;

    const rmsValues = this.samples.map((s) => s.rms);
    const meanRmsDb = this.mean(rmsValues);
    const rmsStd = this.std(rmsValues);
    const dynamicRangeDb =
      rmsValues.length > 0 ? Math.max(...rmsValues) - Math.min(...rmsValues) : null;

    const rmsConsistency =
      meanRmsDb !== null && rmsStd !== null
        ? Math.max(0, Math.min(1, 1 - rmsStd / (Math.abs(meanRmsDb) + 1e-6)))
        : null;

    const midis = this.samples.map((s) => s.midi);
    const centerMidi = this.median(midis);

    let precisionCents: number | null = null;
    let stabilityCents: number | null = null;
    let attackLatencyMs: number | null = null;

    if (centerMidi !== null) {
      const errorsCents = midis.map((m) => (m - centerMidi) * 100); // 1 semitono = 100 cents aprox

      const absErrors = errorsCents.map((e) => Math.abs(e));
      precisionCents = this.mean(absErrors);

      stabilityCents = this.std(errorsCents);

      // Attack: primer momento donde |error| <= 25 cents y RMS suficiente
      const threshold = 25;
      const idx = errorsCents.findIndex(
        (e, i) => Math.abs(e) <= threshold && rmsValues[i] > this.noiseFloorDb + 6,
      );
      if (idx >= 0) {
        attackLatencyMs = this.samples[idx].timestamp - this.startTime;
      }
    }

    return {
      meanRmsDb,
      rmsConsistency,
      dynamicRangeDb,
      durationSec,
      precisionCents,
      stabilityCents,
      attackLatencyMs,
    };
  }

  /**
   * Construye el payload estándar para ExerciseMetric.metricsData
   */
  private buildExercisePayload(metrics: StabilityMetrics): ExerciseMetricsPayload {
    const sessionId = this.calibration.getSessionId() ?? 'unknown';

    const data: MetricsData = {
      // Métricas generales que este ejercicio SÍ produce
      meanRmsDb: metrics.meanRmsDb,
      rmsConsistency: metrics.rmsConsistency,
      dynamicRangeDb: metrics.dynamicRangeDb,
      durationSec: metrics.durationSec,

      // Métricas específicas de estabilidad
      precisionCents: metrics.precisionCents,
      stabilityCents: metrics.stabilityCents,
      attackLatencyMs: metrics.attackLatencyMs,

      // Este ejercicio NO calcula rango ni vibrato (por ahora)
      rangeMinMidi: null,
      rangeMaxMidi: null,
      rangeSpanSemitones: null,

      vibratoRateHz: null,
      vibratoDepthCents: null,
    };

    return {
      sessionId,
      exerciseId: 'stability',
      attemptNumber: 1,
      metricsData: data,
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
    if (!environment.production) {
      console.log('[stability]', event, data || '');
    }
  }
}
