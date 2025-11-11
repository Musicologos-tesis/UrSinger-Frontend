import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { StudentProgress, ProgressStatus, ProgressMetrics } from '../models';
import { LearningService } from './learning.service';

@Injectable({
  providedIn: 'root'
})
export class ProgressService {
  private learning = inject(LearningService);

  // Progreso actual del usuario
  private currentProgress$ = new BehaviorSubject<StudentProgress | null>(null);
  private userProgress$ = new BehaviorSubject<StudentProgress[]>([]);
  private loading$ = new BehaviorSubject<boolean>(false);
  private error$ = new BehaviorSubject<string | null>(null);

  // Observables públicos
  readonly currentProgress = this.currentProgress$.asObservable();
  readonly userProgress = this.userProgress$.asObservable();
  readonly loading = this.loading$.asObservable();
  readonly error = this.error$.asObservable();

  /**
   * Obtiene todo el progreso de un usuario
   */
  async loadUserProgress(userId: string, techniqueId?: string): Promise<void> {
    try {
      this.loading$.next(true);
      this.error$.next(null);
      const progress = await this.learning.getUserProgress(userId, techniqueId);
      this.userProgress$.next(progress);
    } catch (error: any) {
      const message = error.message || 'Error al cargar el progreso';
      this.error$.next(message);
      console.error(message, error);
    } finally {
      this.loading$.next(false);
    }
  }

  /**
   * Establece el progreso actual a visualizar
   */
  setCurrentProgress(progress: StudentProgress | null): void {
    this.currentProgress$.next(progress);
  }

  /**
   * Obtiene el progreso actual
   */
  getCurrentProgress(): StudentProgress | null {
    return this.currentProgress$.value;
  }

  /**
   * Obtiene todo el progreso del usuario
   */
  getAllProgress(): StudentProgress[] {
    return this.userProgress$.value;
  }

  /**
   * Calcula el promedio de puntuaciones de todas las lecciones
   */
  getAverageScore(): number {
    const progress = this.userProgress$.value;
    if (progress.length === 0) return 0;

    const completedProgress = progress.filter(
      p => p.status === ProgressStatus.Completed && p.score !== undefined
    );

    if (completedProgress.length === 0) return 0;

    const sum = completedProgress.reduce((acc, p) => acc + (p.score || 0), 0);
    return sum / completedProgress.length;
  }

  /**
   * Obtiene el porcentaje de lecciones completadas
   */
  getCompletionPercentage(): number {
    const progress = this.userProgress$.value;
    if (progress.length === 0) return 0;

    const completed = progress.filter(
      p => p.status === ProgressStatus.Completed
    ).length;

    return (completed / progress.length) * 100;
  }

  /**
   * Obtiene el progreso de una técnica específica
   */
  getTechniqueProgress(techniqueId: string): StudentProgress[] {
    return this.userProgress$.value.filter(
      p => p.techniqueId === techniqueId
    );
  }

  /**
   * Obtiene el progreso de una lección específica
   */
  getLessonProgress(lessonId: string): StudentProgress | undefined {
    return this.userProgress$.value.find(p => p.lessonId === lessonId);
  }

  /**
   * Verifica si una lección está completada
   */
  isLessonCompleted(lessonId: string): boolean {
    const lesson = this.getLessonProgress(lessonId);
    return lesson?.status === ProgressStatus.Completed;
  }

  /**
   * Obtiene el estado de una lección
   */
  getLessonStatus(lessonId: string): ProgressStatus | undefined {
    return this.getLessonProgress(lessonId)?.status;
  }

  /**
   * Calcula métricas generales de dominio
   */
  calculateMasteryMetrics(): ProgressMetrics {
    const progress = this.userProgress$.value;

    // Precisión promedio
    const withMetrics = progress.filter(p => p.metrics);
    const averageAccuracy = withMetrics.length > 0
      ? withMetrics.reduce((acc, p) => acc + (p.metrics?.averageAccuracy || 0), 0) /
        withMetrics.length
      : 0;

    // Consistencia
    const consistencyScore = withMetrics.length > 0
      ? withMetrics.reduce((acc, p) => acc + (p.metrics?.consistencyScore || 0), 0) /
        withMetrics.length
      : 0;

    // Dominio general (basado en completación y puntuación)
    const techniqueMastery = (this.getCompletionPercentage() + this.getAverageScore()) / 2;

    return {
      averageAccuracy,
      consistencyScore,
      techniqueMastery
    };
  }

  /**
   * Reinicia el estado del servicio
   */
  reset(): void {
    this.currentProgress$.next(null);
    this.userProgress$.next([]);
    this.loading$.next(false);
    this.error$.next(null);
  }
}
