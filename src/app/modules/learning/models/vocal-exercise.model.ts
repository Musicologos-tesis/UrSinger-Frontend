import { PitchRange, DynamicRange } from './vocal-lesson.model';

/**
 * Métricas objetivo para un ejercicio
 */
export interface TargetMetrics {
  pitchAccuracy: number; // Precisión requerida en cents
  stability: number; // Variación máxima permitida
  vibratoRate?: number; // Hz objetivo para vibrato
  vibratoDepth?: number; // Cents objetivo para vibrato
}

/**
 * Ejercicio vocal
 */
export interface VocalExercise {
  id: string;
  techniqueId: string;
  name: string;
  description: string;
  duration: number; // Segundos
  difficulty: number; // 1-5
  pitchRange: PitchRange;
  dynamicRange: DynamicRange;
  targetMetrics: TargetMetrics;
  audioUrl?: string; // URL del audio de ejemplo
  sheetMusic?: string; // URL de partitura
  instructions: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * DTO para crear un ejercicio
 */
export interface CreateExerciseDto {
  techniqueId: string;
  name: string;
  description: string;
  duration: number;
  difficulty: number;
  pitchRange: PitchRange;
  dynamicRange: DynamicRange;
  targetMetrics: TargetMetrics;
  instructions: string;
  audioUrl?: string;
  sheetMusic?: string;
}

/**
 * DTO para actualizar un ejercicio
 */
export interface UpdateExerciseDto {
  name?: string;
  description?: string;
  duration?: number;
  difficulty?: number;
  pitchRange?: PitchRange;
  dynamicRange?: DynamicRange;
  targetMetrics?: TargetMetrics;
  instructions?: string;
  audioUrl?: string;
  sheetMusic?: string;
}
