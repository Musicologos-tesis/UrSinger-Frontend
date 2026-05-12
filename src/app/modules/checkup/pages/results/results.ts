import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { VocalRangeService, RangeMetrics } from '../../services/vocal-range.service';
import { StabilityService, StabilityMetrics } from '../../services/stability.service';
import { AudioPitchService } from '../../services/audio-pitch.service';
import { MetricsService, FullMetrics, EvaluateMetricsResponse } from '../../services/metrics.service';
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

interface WeaknessGroupDisplay {
  code: string;
  label: string;
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
  evaluateResult: EvaluateMetricsResponse | null = null;

  private readonly groupCodeLabels: Record<string, string> = {
    G1: 'Soporte respiratorio y control del aire',
    G2: 'Afinación y oído tonal',
    G3: 'Estabilidad y vibrato controlado',
    G4: 'Potencia y control dinámico',
    G5: 'Rango y flexibilidad vocal',
  };

  checkupCompleted = false;
  showLearningPathInfoModal = false;
  isNavigating = signal(false);

  async ngOnInit(): Promise<void> {
    this.evaluateResult = this.metricsService.getEvaluateResult();

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
          this.precisionPercent = this.centsToScore(this.fullMetrics.precisionCents, 47, 600);
          this.stabilityPercent = this.centsToScore(this.fullMetrics.stabilityCents, 23, 200);
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
        this.precisionPercent = this.centsToScore(precisionCents, 47, 600);
      }

      if (stabilityCents !== null) {
        this.stabilityPercent = this.centsToScore(stabilityCents, 23, 200);
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

  private centsToScore(cents: number, midpoint: number, max: number): number {
    if (cents >= max) return 0;
    if (cents <= 0) return 100;
    if (cents >= midpoint) {
      return Math.round(50 * (max - cents) / (max - midpoint));
    } else {
      return Math.round(50 + 50 * (midpoint - cents) / midpoint);
    }
  }

  get weaknessGroupsForDisplay(): WeaknessGroupDisplay[] {
    const evaluateGroups = this.evaluateResult?.weaknessAnalysis?.groups;
    if (evaluateGroups?.length) {
      return evaluateGroups.map(code => ({
        code,
        label: this.groupCodeLabels[code] ?? code,
      }));
    }

    return (this.trainingPlan?.focusGroups ?? []).map(label => {
      const inferredCode = this.extractGroupCode(label) || this.findCodeByLabel(label) || label;
      return {
        code: inferredCode,
        label,
      };
    });
  }

  getFocusGroupBadge(group: WeaknessGroupDisplay): string {
    const metric = this.getWeaknessMetricForGroup(group.code);
    if (!metric) {
      return group.label;
    }

    const achievement = Math.max(0, Math.min(100, metric.achievement_pct));
    const missing = Math.max(0, Math.min(100, metric.missing_to_clear_pct));
    return `${group.label} · logrado ${achievement.toFixed(2)}% (faltó ${missing.toFixed(2)}%)`;
  }

  private getWeaknessMetricForGroup(group: string) {
    const groupMetrics = this.evaluateResult?.weaknessAnalysis?.groupMetrics;
    if (!groupMetrics) {
      return null;
    }

    if (groupMetrics[group]) {
      return groupMetrics[group];
    }

    const extractedCode = this.extractGroupCode(group);
    if (extractedCode && groupMetrics[extractedCode]) {
      return groupMetrics[extractedCode];
    }

    return null;
  }

  private extractGroupCode(label: string): string | null {
    const match = label.toUpperCase().match(/\bG\d+\b/);
    return match ? match[0] : null;
  }

  private findCodeByLabel(label: string): string | null {
    const normalizedTarget = this.normalizeLabel(label);
    const entry = Object.entries(this.groupCodeLabels).find(([, name]) => this.normalizeLabel(name) === normalizedTarget);
    return entry ? entry[0] : null;
  }

  private normalizeLabel(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    this.isNavigating.set(true);
    localStorage.removeItem('ursinger.checkup.sessionId');
    localStorage.removeItem('ursinger.metrics.partial');
    this.metricsService.clearEvaluateResult();
    console.log('[Results] Checkup finalizado - SessionId y métricas limpiadas');
    this.router.navigate(['/training/dashboard']);
  }

  openLearningPathInfoModal(): void {
    this.showLearningPathInfoModal = true;
  }

  closeLearningPathInfoModal(): void {
    this.showLearningPathInfoModal = false;
  }
}
