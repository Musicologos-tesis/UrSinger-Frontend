import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TrainingService, ActiveTrainingPlan, Exercise, LatestEvaluationSummaryResponse } from '../../services/training.service';
import { AuthService } from '../../../../services/auth.service';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';
import { ExerciseGroupIconComponent } from '../../components/exercise-group-icon/exercise-group-icon.component';

@Component({
  selector: 'app-training-dashboard',
  standalone: true,
  imports: [CommonModule, AuthHeaderComponent, ExerciseGroupIconComponent],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class TrainingDashboardComponent implements OnInit {
  private router = inject(Router);
  private trainingService = inject(TrainingService);
  private authService = inject(AuthService);

  trainingPlan: ActiveTrainingPlan | null = null;
  evaluationSummary: LatestEvaluationSummaryResponse | null = null;
  evaluationSummaryError: string | null = null;
  evaluationInfoMessage: string | null = null;
  showEvaluationDetailModal = false;
  isLoading = false;
  error: string | null = null;

  private readonly weaknessLabels: Record<string, string> = {
    G1: 'Soporte respiratorio y control del aire',
    G2: 'Afinacion y oido tonal',
    G3: 'Estabilidad y vibrato controlado',
    G4: 'Potencia y control dinamico',
    G5: 'Rango y flexibilidad vocal',
  };

  async ngOnInit(): Promise<void> {
    await this.loadActivePlan();
  }

  async loadActivePlan(): Promise<void> {
    try {
      this.isLoading = true;
      this.error = null;

      const profileId = localStorage.getItem('profile_id');
      if (!profileId) {
        this.error = 'No se encontró el perfil del usuario';
        return;
      }

      const [planResult, summaryResult] = await Promise.allSettled([
        this.trainingService.getActivePlan(profileId),
        this.trainingService.getLatestEvaluationSummary(profileId),
      ]);

      if (planResult.status === 'fulfilled') {
        this.trainingPlan = planResult.value;
      } else {
        throw planResult.reason;
      }

      if (summaryResult.status === 'fulfilled') {
        this.evaluationSummary = summaryResult.value;
        this.evaluationSummaryError = null;
        this.evaluationInfoMessage = null;
      } else {
        console.warn('[TrainingDashboard] Resumen comparativo no disponible:', summaryResult.reason);

        try {
          const latestRange = await this.trainingService.getLatestVocalRange(profileId);
          this.evaluationSummary = {
            profileId,
            latest: {
              evaluationId: latestRange.evaluationId,
              sessionId: latestRange.sessionId,
              evaluatedAt: latestRange.evaluatedAt,
              range: {
                minMidi: latestRange.vocalRange.minMidi,
                maxMidi: latestRange.vocalRange.maxMidi,
                spanSemitones: latestRange.vocalRange.spanSemitones,
                minNote: latestRange.vocalRange.minNote,
                maxNote: latestRange.vocalRange.maxNote,
              },
            },
            previous: null,
            delta: undefined,
            trend: undefined,
          };
          this.evaluationSummaryError = null;
          this.evaluationInfoMessage = 'Mostrando la última evaluación disponible. La comparación histórica aún no está lista.';
        } catch (latestError) {
          console.warn('[TrainingDashboard] Tampoco se pudo obtener última evaluación:', latestError);
          this.evaluationSummary = null;
          this.evaluationSummaryError = 'Aún no hay evaluación comparativa disponible.';
          this.evaluationInfoMessage = null;
        }
      }
    } catch (error: any) {
      console.error('[TrainingDashboard] Error al cargar plan:', error);
      this.error = 'No se pudo cargar el plan de entrenamiento';
    } finally {
      this.isLoading = false;
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  formatDateTime(dateString?: string): string {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  getTrendLabel(): string {
    const trend = (this.evaluationSummary?.trend ?? '').toLowerCase();
    if (trend === 'improving') return 'En mejora';
    if (trend === 'declining') return 'En descenso';
    if (trend === 'stable') return 'Estable';
    return 'Sin tendencia';
  }

  getTrendClass(): string {
    const trend = (this.evaluationSummary?.trend ?? '').toLowerCase();
    if (trend === 'improving') return 'trend trend--up';
    if (trend === 'declining') return 'trend trend--down';
    return 'trend trend--neutral';
  }

  getRangeLabel(): string {
    const min = this.evaluationSummary?.latest?.range?.minNote;
    const max = this.evaluationSummary?.latest?.range?.maxNote;
    if (!min || !max) return '—';
    return `${min} - ${max}`;
  }

  getWeaknessesForDisplay(): string[] {
    const groups = this.evaluationSummary?.latest?.weaknessesDetected ?? [];
    if (!Array.isArray(groups) || groups.length === 0) {
      return [];
    }
    return groups.map((group) => this.getWeaknessLabel(group));
  }

  getImprovementHighlights(): string[] {
    const highlights: string[] = [];
    const delta = this.evaluationSummary?.delta;

    if (!delta) {
      return highlights;
    }

    if (this.isImprovement(delta.precisionCents, true)) {
      highlights.push(`Precision ${this.formatDeltaMagnitude(delta.precisionCents, 'c')}`);
    }
    if (this.isImprovement(delta.stabilityCents, true)) {
      highlights.push(`Estabilidad ${this.formatDeltaMagnitude(delta.stabilityCents, 'c')}`);
    }
    if (this.isImprovement(delta.dynamicRangeDb, false)) {
      highlights.push(`Dinamica ${this.formatDeltaMagnitude(delta.dynamicRangeDb, 'dB')}`);
    }
    if (this.isImprovement(delta.rangeSpanSemitones, false)) {
      highlights.push(`Rango util ${this.formatDeltaMagnitude(delta.rangeSpanSemitones, 'st')}`);
    }
    if (this.isImprovement(delta.overallScore, false)) {
      highlights.push(`Score general ${this.formatDeltaMagnitude(delta.overallScore, 'pts')}`);
    }

    return highlights;
  }

  getAttentionHighlights(): string[] {
    const highlights: string[] = [];
    const delta = this.evaluationSummary?.delta;

    if (!delta) {
      return highlights;
    }

    if (this.isRegression(delta.precisionCents, true)) {
      highlights.push(`Precision ${this.formatDeltaMagnitude(delta.precisionCents, 'c')}`);
    }
    if (this.isRegression(delta.stabilityCents, true)) {
      highlights.push(`Estabilidad ${this.formatDeltaMagnitude(delta.stabilityCents, 'c')}`);
    }
    if (this.isRegression(delta.dynamicRangeDb, false)) {
      highlights.push(`Dinamica ${this.formatDeltaMagnitude(delta.dynamicRangeDb, 'dB')}`);
    }
    if (this.isRegression(delta.rangeSpanSemitones, false)) {
      highlights.push(`Rango util ${this.formatDeltaMagnitude(delta.rangeSpanSemitones, 'st')}`);
    }
    if (this.isRegression(delta.overallScore, false)) {
      highlights.push(`Score general ${this.formatDeltaMagnitude(delta.overallScore, 'pts')}`);
    }

    return highlights;
  }

  hasHistoricalComparison(): boolean {
    return !!this.evaluationSummary?.previous;
  }

  openEvaluationDetailModal(): void {
    this.showEvaluationDetailModal = true;
  }

  closeEvaluationDetailModal(): void {
    this.showEvaluationDetailModal = false;
  }

  formatMetric(value?: number): string {
    if (value === undefined || value === null || !Number.isFinite(value)) return '—';
    return `${Math.round(value * 10) / 10}`;
  }

  /** Formatos amigables para usuarios no musicales */
  formatPrecisionFriendly(value?: number): string {
    if (value === undefined || value === null || !Number.isFinite(value)) return '—';
    const v = Math.round(value * 10) / 10;
    return `${v} centésimas`;
  }

  formatDbFriendly(value?: number): string {
    if (value === undefined || value === null || !Number.isFinite(value)) return '—';
    const v = Math.round(value * 10) / 10;
    return `${v} decibeles`;
  }

  formatSemitoneFriendly(value?: number): string {
    if (value === undefined || value === null || !Number.isFinite(value)) return '—';
    const v = Math.round(value);
    const octaves = (v / 12);
    const approx = octaves >= 1 ? ` (~${(Math.round(octaves*10)/10)} oct.)` : '';
    return `${v} semitonos${approx}`;
  }

  formatStabilityFriendly(value?: number): string {
    if (value === undefined || value === null || !Number.isFinite(value)) return '—';
    const v = Math.round(value * 10) / 10;
    return `${v} centésimas`;
  }

  getDeltaClass(value: number | undefined, lowerIsBetter = false): string {
    if (value === undefined || value === null || !Number.isFinite(value) || value === 0) {
      return 'delta delta--neutral';
    }
    const improved = lowerIsBetter ? value < 0 : value > 0;
    return improved ? 'delta delta--good' : 'delta delta--bad';
  }

  getDeltaText(value: number | undefined, unit: string, lowerIsBetter = false): string {
    if (value === undefined || value === null || !Number.isFinite(value) || value === 0) {
      return 'Sin cambio';
    }
    const improved = lowerIsBetter ? value < 0 : value > 0;
    const abs = Math.round(Math.abs(value) * 10) / 10;
    const unitFull = this.unitFullName(unit);
    return `${improved ? 'Mejora' : 'Atención'} ${abs} ${unitFull}`;
  }

  getProgressPercentage(): number {
    if (!this.trainingPlan) return 0;
    return Math.round((this.trainingPlan.completedThisWeek / this.trainingPlan.totalExercises) * 100);
  }

  canStartExercise(exercise: Exercise, dayExercises: Exercise[]): boolean {
    // El primer ejercicio siempre está disponible
    const exerciseIndex = dayExercises.indexOf(exercise);
    if (exerciseIndex === 0) return true;

    // Los demás ejercicios requieren que el anterior esté completado
    const previousExercise = dayExercises[exerciseIndex - 1];
    return previousExercise.isCompletedThisWeek;
  }

  startExercise(exercise: Exercise): void {
    if (!this.canStartExercise(exercise, this.getExercisesForDay(exercise))) {
      return;
    }
    
    // Si ya está completado, no hacer nada
    if (exercise.isCompletedThisWeek) {
      return;
    }
    
    console.log('[TrainingDashboard] Iniciando ejercicio:', exercise.exerciseName);
    this.router.navigate(['/training/exercise', exercise.planExerciseId]);
  }

  private getExercisesForDay(exercise: Exercise): Exercise[] {
    if (!this.trainingPlan) return [];
    const day = this.trainingPlan.weekPlan.find(d =>
      d.exercises.some(e => e.planExerciseId === exercise.planExerciseId)
    );
    return day?.exercises || [];
  }

  goToCheckup(): void {
    this.router.navigate(['/checkup/preparation']);
  }

  goToProfile(): void {
    this.router.navigate(['/profile']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }

  private getWeaknessLabel(groupCode: string): string {
    if (!groupCode) return 'Grupo por evaluar';
    const normalizedCode = groupCode
      .toUpperCase()
      .replace(/^WEAK[_-]?/, '')
      .trim();

    return this.weaknessLabels[normalizedCode] ?? groupCode;
  }

  private isImprovement(value: number | undefined, lowerIsBetter: boolean): boolean {
    if (value === undefined || value === null || !Number.isFinite(value) || value === 0) {
      return false;
    }
    return lowerIsBetter ? value < 0 : value > 0;
  }

  private isRegression(value: number | undefined, lowerIsBetter: boolean): boolean {
    if (value === undefined || value === null || !Number.isFinite(value) || value === 0) {
      return false;
    }
    return lowerIsBetter ? value > 0 : value < 0;
  }

  private formatDeltaMagnitude(value: number | undefined, unit: string): string {
    if (value === undefined || value === null || !Number.isFinite(value) || value === 0) {
      return 'sin cambio';
    }
    const abs = Math.round(Math.abs(value) * 10) / 10;
    const unitFull = this.unitFullName(unit);
    return `${abs} ${unitFull}`;
  }

  private unitFullName(unit: string): string {
    if (!unit) return unit;
    const normalized = unit.trim().toLowerCase();
    switch (normalized) {
      case 'c':
      case 'cent':
      case 'cents':
        return 'centésimas';
      case 'db':
      case 'db':
        return 'decibeles';
      case 'st':
      case 'semitonos':
        return 'semitonos';
      case 'pts':
      case 'pts.':
      case 'puntos':
        return 'puntos';
      default:
        return unit;
    }
  }
}
