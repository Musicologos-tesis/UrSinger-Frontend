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
import { MetricsService } from '../../services/metrics.service';
import { StepperComponent } from '../../../../shared/components/stepper/stepper.component';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';

type UiState = 'intro' | 'recording' | 'done';

@Component({
  selector: 'app-stability',
  standalone: true,
  imports: [CommonModule, StepperComponent, AuthHeaderComponent],
  templateUrl: './stability.html',
  styleUrl: './stability.scss',
})
export class StabilityComponent implements OnDestroy {
  private router = inject(Router);
  private audio = inject(AudioAnalyzerService);
  private stabilityService = inject(StabilityService);
  private metricsService = inject(MetricsService);

  state = signal<UiState>('intro');
  remainingSeconds = signal(10);
  errorMessage = signal<string | null>(null);

  // Feedback en tiempo real
  currentNote = signal<string>('-');
  currentMidi = signal<number>(0);
  currentConfidence = signal<number>(0);
  currentRms = signal<number>(-90);
  samplesCount = signal<number>(0);

  stabilityPercent: number | null = null;

  private timerId: any = null;

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

    // Si hay métricas válidas, calculamos el "score"
    if (metrics.stabilityCents !== null && metrics.stabilityCents !== undefined) {
      const spread = metrics.stabilityCents;
      
      // Fórmula: mientras menor spread (desviación), mejor score
      // 0 cents = 100%, 200 cents = 0%
      const score = Math.max(0, Math.min(100, 100 - spread / 2));
      this.stabilityPercent = Math.round(score);
      
      console.log('[Stability] Spread (stabilityCents):', spread.toFixed(2), 'cents');
      console.log('[Stability] Score calculado:', this.stabilityPercent, '%');
    } else {
      console.warn('[Stability] stabilityCents es null - no se pudo calcular score');
      console.warn('[Stability] Métricas completas:', JSON.stringify(metrics, null, 2));
      this.stabilityPercent = 0;
    }

    // (Opcional) puedes revisar en consola el payload ML listo:
    console.log('[stability] payload para backend:', this.stabilityService.lastPayload);

    this.state.set('done');
  }

  async goToResults() {
    try {
      // Enviar métricas finales al backend antes de navegar
      console.log('[Stability] Enviando métricas a /metrics/evaluate...');
      const response = await this.metricsService.evaluateMetrics();
      console.log('[Stability] Métricas enviadas exitosamente:', response);
      
      // Navegar a resultados
      this.router.navigate(['/checkup/results']);
    } catch (error: any) {
      console.error('[Stability] Error al enviar métricas:', error);
      // Preguntar al usuario si desea continuar a resultados sin enviar
      const continuar = confirm('No se pudieron enviar las métricas al servidor. ¿Deseas continuar a resultados de todas formas?');
      if (continuar) {
        this.router.navigate(['/checkup/results']);
      }
    }
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.audio.stop();
    this.stabilityService.reset();
  }
}
