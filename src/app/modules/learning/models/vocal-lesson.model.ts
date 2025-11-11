import { TechniqueMode } from './vocal-technique.model';

/**
 * Rango de notas en MIDI
 */
export interface PitchRange {
  minMidi: number;
  maxMidi: number;
}

/**
 * Rango dinámico (volumen)
 */
export interface DynamicRange {
  minDb: number;
  maxDb: number;
}

/**
 * Lección de técnica vocal
 */
export interface VocalLesson {
  id: string;
  techniqueId: string;
  title: string;
  description: string;
  level: number; // 1: Beginner, 2: Intermediate, 3: Advanced
  orderIndex: number;
  prerequisites: string[]; // IDs de lecciones previas
  techniqueMode: TechniqueMode;
  pitchRange: PitchRange;
  dynamicRange: DynamicRange;
  createdAt: Date;
  updatedAt: Date;
  exercises?: LessonExercise[];
}

/**
 * Relación entre lección y ejercicio
 */
export interface LessonExercise {
  id: string;
  lessonId: string;
  exerciseId: string;
  orderIndex: number;
  required: boolean;
  createdAt: Date;
}

/**
 * DTO para crear una lección
 */
export interface CreateLessonDto {
  techniqueId: string;
  title: string;
  description: string;
  level: number;
  orderIndex: number;
  prerequisites?: string[];
  techniqueMode: TechniqueMode;
  pitchRange: PitchRange;
  dynamicRange: DynamicRange;
}

/**
 * DTO para actualizar una lección
 */
export interface UpdateLessonDto {
  title?: string;
  description?: string;
  level?: number;
  techniqueMode?: TechniqueMode;
  pitchRange?: PitchRange;
  dynamicRange?: DynamicRange;
  prerequisites?: string[];
}
