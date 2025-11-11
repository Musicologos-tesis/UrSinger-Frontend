/**
 * Retroalimentación detallada de un intento
 */
export interface AttemptFeedback {
  strengths: string[];
  improvements: string[];
  tips: string[];
  overallComment: string;
}

/**
 * Intento de ejercicio del estudiante
 */
export interface ExerciseAttempt {
  id: string;
  userId: string;
  exerciseId: string;
  progressId: string;
  
  // Métricas de rendimiento
  pitchAccuracy?: number; // Precisión en cents
  stability?: number; // Estabilidad de la nota
  vibratoRate?: number; // Tasa de vibrato en Hz
  vibratoDepth?: number; // Profundidad del vibrato en cents
  dynamicControl?: number; // Control del volumen
  
  // Análisis técnico
  techniqueScore?: number;
  feedback?: AttemptFeedback;
  
  audioUrl?: string; // URL del audio grabado
  duration: number; // Duración en segundos
  completed: boolean;
  createdAt: Date;
}

/**
 * DTO para enviar un intento de ejercicio
 */
export interface SubmitExerciseAttemptDto {
  userId: string;
  exerciseId: string;
  progressId: string;
  audioUrl: string;
  duration: number;
  
  // Métricas opcionales (pueden venir del análisis de audio)
  pitchAccuracy?: number;
  stability?: number;
  vibratoRate?: number;
  vibratoDepth?: number;
  dynamicControl?: number;
}

/**
 * Respuesta del servidor al enviar un intento
 */
export interface ExerciseAttemptResponse {
  attempt: ExerciseAttempt;
  feedback: AttemptFeedback;
  passed: boolean; // Si cumple con los criterios mínimos
  score: number; // 0-100
}
