import { ProgressStatus } from './vocal-technique.model';

/**
 * Métricas de progreso del estudiante
 */
export interface ProgressMetrics {
  averageAccuracy: number; // Promedio de precisión
  consistencyScore: number; // Puntuación de consistencia
  techniqueMastery: number; // Dominio de la técnica
}

/**
 * Progreso de un estudiante en una lección
 */
export interface StudentProgress {
  id: string;
  userId: string;
  evaluationId: string; // Referencia a EvaluationSession
  techniqueId: string;
  lessonId: string;
  status: ProgressStatus;
  score?: number; // 0-100
  metrics?: ProgressMetrics;
  startedAt: Date;
  completedAt?: Date;
}

/**
 * DTO para crear o actualizar progreso
 */
export interface CreateProgressDto {
  userId: string;
  evaluationId: string;
  techniqueId: string;
  lessonId: string;
  status?: ProgressStatus;
}

/**
 * DTO para actualizar progreso
 */
export interface UpdateProgressDto {
  status?: ProgressStatus;
  score?: number;
  metrics?: ProgressMetrics;
  completedAt?: Date;
}
