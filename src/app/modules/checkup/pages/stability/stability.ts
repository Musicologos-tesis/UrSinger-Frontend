import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AudioAnalyzerService
} from '../../services/audio.analyzer.service';
import {
  StabilityService,
  StabilityMetrics
} from '../../services/stability.service';

type UiState = 'intro' | 'recording' | 'done';

@Component({
  selector: 'app-stability',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stability.html',
  styleUrl: './stability.scss',
})
export class StabilityComponent implements OnDestroy {
  private router = inject(Router);
  private audio = inject(AudioAnalyzerService);
  private stabilityService = inject(StabilityService);

  state = signal<UiState>('intro');
  remainingSeconds = signal(10);
  errorMessage = signal<string | null>(null);

  stabilityPercent: number | null = null;

  private timerId: any = null;

  async startTest() {
    // limpiar estado anterior
    this.errorMessage.set(null);
    this.stabilityPercent = null;
    this.stabilityService.reset();

    this.state.set('recording');
    this.remainingSeconds.set(10);

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
      await this.stabilityService.start(analyser, 10);

      // Iniciar contador visual
      this.startTimer();
    } catch (err: any) {
      this.errorMessage.set(
        err?.message || 'Error al iniciar la prueba de estabilidad.'
      );
      this.state.set('intro');
    }
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

    // Si hay métricas válidas, calculamos el “score”
    if (metrics.stabilityCents !== null) {
      const spread = metrics.stabilityCents;
      const score = Math.max(0, Math.min(100, 100 - spread / 2));
      this.stabilityPercent = score;
    } else {
      this.stabilityPercent = null;
    }

    // (Opcional) puedes revisar en consola el payload ML listo:
    console.log('[stability] payload para backend:', this.stabilityService.lastPayload);

    this.state.set('done');
  }

  goToResults() {
    // cuando tengas la página de resultados, ajusta la ruta
    this.router.navigate(['/checkup/results']);
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.audio.stop();
    this.stabilityService.reset();
  }
}
