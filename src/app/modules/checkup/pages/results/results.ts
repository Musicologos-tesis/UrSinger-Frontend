import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { VocalRangeService, RangeMetrics } from '../../services/vocal-range.service';
import { StabilityService, StabilityMetrics } from '../../services/stability.service';
import { AudioPitchService } from '../../services/audio-pitch.service';
import { MetricsService, FullMetrics } from '../../services/metrics.service';
import { AuthService } from '../../../../services/auth.service';
import { StepperComponent } from '../../../../shared/components/stepper/stepper.component';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';

interface Exercise {
  exerciseName: string;
  groupName: string;
  level: number;
  description: string;
  cvtDescription: string | null;
  evmDescription: string | null;
}

interface DayPlan {
  day: number;
  dayName: string;
  exercises: Exercise[];
}

interface TrainingPlan {
  planId: string;
  focusGroups: string[];
  startDate: string;
  endDate: string;
  weekPlan: DayPlan[];
  instructions: string;
}

@Component({
  selector: 'app-checkup-results',
  standalone: true,
  imports: [CommonModule, StepperComponent, AuthHeaderComponent],
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class CheckupResultsComponent implements OnInit {
  private router = inject(Router);
  private vocalRange = inject(VocalRangeService);
  private stability = inject(StabilityService);
  private pitch = inject(AudioPitchService);
  private metricsService = inject(MetricsService);
  private authService = inject(AuthService);

  // Datos que va a mostrar la UI
  rangeLabel = '---';
  precisionPercent: number | null = null;
  stabilityPercent: number | null = null;                                             
  
  trainingPlan: TrainingPlan | null = null;
  isLoadingPlan = false;
  planError: string | null = null;
  hasActivePlan = false;
  
  fullMetrics: FullMetrics | null = null;

  checkupCompleted = false;

  async ngOnInit(): Promise<void> {
    // Verificar si tiene plan activo
    const profileId = localStorage.getItem('profile_id');
    if (profileId) {
      this.hasActivePlan = await this.authService.checkActiveTrainingPlan(profileId);
    }

    // Obtener sessionId
    const sessionId = localStorage.getItem('ursinger.checkup.sessionId');
    
    if (sessionId) {
      // Cargar métricas completas desde el backend
      try {
        this.fullMetrics = await this.metricsService.getFullMetrics(sessionId);
        
        // Actualizar UI con métricas del backend
        if (this.fullMetrics) {
          this.rangeLabel = this.buildRangeLabelFromMetrics(this.fullMetrics);
          this.precisionPercent = this.centsToScore(this.fullMetrics.precisionCents);
          this.stabilityPercent = this.centsToScore(this.fullMetrics.stabilityCents);
          this.checkupCompleted = true;
        }
      } catch (error) {
        console.error('[Results] Error al cargar métricas completas:', error);
        // Fallback a métricas locales
        this.loadLocalMetrics();
      }
    } else {
      // Fallback a métricas locales si no hay sessionId
      this.loadLocalMetrics();
    }

    // Cargar plan de entrenamiento
    await this.loadTrainingPlan();
  }

  private loadLocalMetrics(): void {
    const rangeMetrics = this.vocalRange.getCalculatedMetrics();
    const stabilityMetrics = this.stability.lastMetrics;

    // ---- RANGO VOCAL ----
    if (rangeMetrics) {
      this.rangeLabel = this.buildRangeLabel(rangeMetrics);
      this.checkupCompleted = true;
    }

    // ---- PRECISIÓN / ESTABILIDAD ----
    if (stabilityMetrics) {
      const { precisionCents, stabilityCents } = stabilityMetrics;

      if (precisionCents !== null) {
        this.precisionPercent = this.centsToScore(precisionCents);
      }

      if (stabilityCents !== null) {
        this.stabilityPercent = this.centsToScore(stabilityCents);
      }

      this.checkupCompleted = true;
    }
  }

  async loadTrainingPlan(): Promise<void> {
    try {
      this.isLoadingPlan = true;
      this.planError = null;
      this.trainingPlan = await this.metricsService.generateTrainingPlan();
    } catch (error: any) {
      console.error('[Results] Error al cargar plan:', error);
      this.planError = 'No se pudo generar el plan de entrenamiento';
    } finally {
      this.isLoadingPlan = false;
    }
  }

  private buildRangeLabel(metrics: RangeMetrics | undefined): string {
    if (!metrics || metrics.rangeMinMidi == null || metrics.rangeMaxMidi == null) {
      return 'Completa la prueba de rango vocal.';
    }

    const minName = this.pitch.midiToNoteName(metrics.rangeMinMidi);
    const maxName = this.pitch.midiToNoteName(metrics.rangeMaxMidi);
    const span = Math.round(metrics.rangeSpanSemitones ?? 0);

    return `${minName} – ${maxName} (${span} semitonos)`;
  }

  private buildRangeLabelFromMetrics(metrics: FullMetrics): string {
    const minName = this.pitch.midiToNoteName(metrics.rangeMinMidi);
    const maxName = this.pitch.midiToNoteName(metrics.rangeMaxMidi);
    const span = Math.round(metrics.rangeSpanSemitones);

    return `${minName} – ${maxName} (${span} semitonos)`;
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  getDayName(dayNumber: number): string {
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    // El plan usa día 1, 3, 5 que corresponde a Lunes, Miércoles, Viernes (asumiendo inicio el lunes)
    const dayMap: Record<number, string> = {
      1: 'Lunes',
      2: 'Martes', 
      3: 'Miércoles',
      4: 'Jueves',
      5: 'Viernes',
      6: 'Sábado',
      7: 'Domingo'
    };
    return dayMap[dayNumber] || `Día ${dayNumber}`;
  }

  /** Convierte “error en cents” a un score de 0–100 (ajustable). */
  private centsToScore(cents: number): number {
    const raw = 100 - cents / 2; // mientras más error, menor score
    return Math.max(0, Math.min(100, Math.round(raw)));
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

  finishCheckup() {
    localStorage.removeItem('ursinger.checkup.sessionId');
    localStorage.removeItem('ursinger.metrics.partial');
    console.log('[Results] Checkup finalizado - SessionId y métricas limpiadas');
    this.router.navigate(['/training/dashboard']);
  }
}
