import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AudioAnalyzerService
} from '../../services/audio.analyzer.service';
import {
  StabilityService,
  StabilityMetrics
} from '../../services/stability.service';
import { MetricsService } from '../../services/metrics.service';
import { AuthService } from '../../../../services/auth.service';
import { StepperComponent } from '../../../../shared/components/stepper/stepper.component';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';
import { FlashcardComponent } from '../../../../shared/components/flashcard/flashcard.component';

type UiState = 'intro' | 'recording' | 'done';

@Component({
  selector: 'app-stability',
  standalone: true,
  imports: [CommonModule, StepperComponent, AuthHeaderComponent, FlashcardComponent],
  templateUrl: './stability.html',
  styleUrl: './stability.scss',
})
export class StabilityComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private audio = inject(AudioAnalyzerService);
  private stabilityService = inject(StabilityService);
  private metricsService = inject(MetricsService);
  private authService = inject(AuthService);

  state = signal<UiState>('intro');
  remainingSeconds = signal(10);
  errorMessage = signal<string | null>(null);

  // Feedback en tiempo real
  currentNote = signal<string>('-');
  currentMidi = signal<number>(0);
  currentConfidence = signal<number>(0);
  currentRms = signal<number>(-90);
  samplesCount = signal<number>(0);
  hasActivePlan = signal(false);
  targetMidi = signal<number>(0);
  targetNote = signal<string>('-');

  stabilityPercent: number | null = null;
  isNavigating = signal(false);
  isNoteLoading = signal(false);

  private timerId: any = null;
  private sfAudioContext: AudioContext | null = null;
  private sfBufferCache = new Map<string, AudioBuffer>();
  private sfRawCache = new Map<string, ArrayBuffer>();

  async ngOnInit(): Promise<void> {
    const profileId = localStorage.getItem('profile_id');
    if (profileId) {
      this.hasActivePlan.set(await this.authService.checkActiveTrainingPlan(profileId));
    }

    this.loadTargetNote();
  }

  private loadTargetNote(): void {
    const stored = localStorage.getItem('ursinger.metrics.partial');
    if (!stored) return;

    try {
      const metrics = JSON.parse(stored);
      const minMidi = metrics.rangeMinMidi;
      const maxMidi = metrics.rangeMaxMidi;
      if (typeof minMidi === 'number' && typeof maxMidi === 'number') {
        const mid = Math.round((minMidi + maxMidi) / 2);
        this.targetMidi.set(mid);
        this.targetNote.set(this.formatNote(mid));
        this.prefetchTargetNote(mid);
      }
    } catch {
      return;
    }
  }

  private prefetchTargetNote(midi: number): void {
    const url = this.buildSoundFontUrl(midi);
    if (this.sfBufferCache.has(url) || this.sfRawCache.has(url)) return;
    this.isNoteLoading.set(true);
    fetch(url)
      .then(r => r.arrayBuffer())
      .then(ab => this.sfRawCache.set(url, ab))
      .catch(() => {})
      .finally(() => this.isNoteLoading.set(false));
  }

  async startTest() {
    // limpiar estado anterior
    this.errorMessage.set(null);
    this.stabilityPercent = null;
    this.stabilityService.reset();

    this.state.set('recording');
    this.remainingSeconds.set(10);
    
    // Suscribirse a feedback en tiempo real
    this.stabilityService.currentNote$.subscribe(note => this.currentNote.set(note));
    this.stabilityService.currentMidi$.subscribe(midi => this.currentMidi.set(midi));
    this.stabilityService.currentConfidence$.subscribe(conf => this.currentConfidence.set(conf));
    this.stabilityService.currentRms$.subscribe(rms => this.currentRms.set(rms));
    this.stabilityService.samplesCount$.subscribe(count => this.samplesCount.set(count));

    try {
      let analyser = this.audio.getAnalyser();
      if (!analyser) {
        await this.audio.requestMic();
        analyser = this.audio.getAnalyser();
        if (!analyser) {
          throw new Error('No se pudo inicializar el micrófono.');
        }
      }

      // Iniciar captura en el service
      await this.stabilityService.start(analyser, 10, this.targetMidi());

      // Iniciar contador visual
      this.startTimer();
    } catch (err: any) {
      this.errorMessage.set(
        err?.message || 'Error al iniciar la prueba de estabilidad.'
      );
      this.state.set('intro');
    }
  }

  async playTargetNote(): Promise<void> {
    const midi = this.targetMidi();
    if (!midi) return;

    try {
      if (!this.sfAudioContext) {
        this.sfAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = this.sfAudioContext;
      const url = this.buildSoundFontUrl(midi);

      let buffer = this.sfBufferCache.get(url);
      if (!buffer) {
        const raw = this.sfRawCache.get(url);
        const arrayBuffer = raw
          ? raw.slice(0)
          : await fetch(url).then(r => r.arrayBuffer());
        buffer = await ctx.decodeAudioData(arrayBuffer);
        this.sfBufferCache.set(url, buffer);
        this.sfRawCache.delete(url);
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.8, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.0);

      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(ctx.currentTime);
      source.stop(ctx.currentTime + 2.0);
    } catch {
      // Silenciar errores de red o decodificación
    }
  }

  private buildSoundFontUrl(midi: number): string {
    const names = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
    const octave = Math.floor(midi / 12) - 1;
    const note = names[midi % 12];
    return `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/${note}${octave}.mp3`;
  }

  private startTimer() {
    this.clearTimer();
    this.timerId = setInterval(() => {
      const current = this.remainingSeconds();
      if (current <= 1) {
        this.finishTest();
      } else {
        this.remainingSeconds.set(current - 1);
      }
    }, 1000);
  }

  private clearTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private finishTest() {
    this.clearTimer();

    const metrics: StabilityMetrics | null =
      this.stabilityService.stopAndComputeMetrics();

    console.log('[Stability] Métricas calculadas:', metrics);
    console.log('[Stability] Total de muestras capturadas:', this.samplesCount());

    // Si el service devolvió null, hubo error (no_samples o very_few_samples)
    if (!metrics) {
      const svcError = this.stabilityService.errorMessage$.value;
      this.errorMessage.set(
        svcError ||
          'No se pudo completar la prueba. Inténtalo nuevamente en un lugar tranquilo.'
      );
      this.state.set('intro');
      return;
    }

    const spread = metrics.stabilityCents ?? null;
    this.stabilityPercent = spread !== null ? this.centsToScore(spread / 1.5, 23, 200) : 0;

    this.state.set('done');
  }

  formatNote(midi: number): string {
    if (!midi || midi <= 0 || !isFinite(midi)) return '-';
    const midiInt = Math.round(midi);
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midiInt / 12) - 1;
    const noteIndex = midiInt % 12;
    const noteName = noteNames[noteIndex];
    if (!noteName) return '-';
    return `${noteName}${octave}`;
  }

  async goToResults() {
    this.isNavigating.set(true);
    try {
      // Enviar métricas finales al backend antes de navegar
      console.log('[Stability] Enviando métricas a /metrics/evaluate...');
      const response = await this.metricsService.evaluateMetrics();
      console.log('[Stability] Métricas enviadas exitosamente:', response);

      // Navegar a resultados
      this.router.navigate(['/checkup/results']);
    } catch (error: any) {
      console.error('[Stability] Error al enviar métricas:', error);
      this.isNavigating.set(false);
      const detail = error?.error?.message || error?.message || 'Error desconocido';
      // Preguntar al usuario si desea continuar a resultados sin enviar
      const continuar = confirm(`No se pudieron enviar las métricas al servidor.\n\nDetalle: ${detail}\n\n¿Deseas continuar a resultados de todas formas?`);
      if (continuar) {
        this.isNavigating.set(true);
        this.router.navigate(['/checkup/results']);
      }
    }
  }

  private centsToScore(cents: number, midpoint: number, max: number): number {
    if (cents >= max) return 0;
    if (cents <= 0) return 100;
    if (cents >= midpoint) {
      return Math.round(50 * (max - cents) / (max - midpoint));
    } else {
      return Math.round(50 + 50 * (midpoint - cents) / midpoint);
    }
  }

  goToTraining(): void {
    this.router.navigate(['/training/dashboard']);
  }

  reloadCheckup(): void {
    this.router.navigate(['/checkup/preparation']);
  }

  goToProfile(): void {
    this.router.navigate(['/profile']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.audio.stop();
    this.stabilityService.reset();
    this.sfAudioContext?.close();
    this.sfBufferCache.clear();
    this.sfRawCache.clear();
  }
}
