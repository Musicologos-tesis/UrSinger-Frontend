/**
 * VocalTechnique Model
 * Representa las técnicas vocales disponibles: CVT (Complete Vocal Technique) o EVM (Estill Voice Model)
 */
export interface VocalTechnique {
  id: string;
  name: 'CVT' | 'EVM'; // Complete Vocal Technique o Estill Voice Model
  description: string;
  createdAt: Date;
}

/**
 * Modo específico según la técnica vocal
 */
export type CVTMode = 'neutral' | 'curbing' | 'overdrive' | 'edge';
export type EVMMode = 'speech' | 'sob' | 'twang' | 'belt' | 'opera';

export type TechniqueMode = CVTMode | EVMMode;

/**
 * Nivel de dificultad de lecciones y ejercicios
 */
export enum DifficultyLevel {
  Beginner = 1,
  Intermediate = 2,
  Advanced = 3
}

/**
 * Estados de progreso
 */
export enum ProgressStatus {
  NotStarted = 'not_started',
  InProgress = 'in_progress',
  Completed = 'completed'
}
