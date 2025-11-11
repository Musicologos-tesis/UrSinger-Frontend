# Integración del Módulo Learning - Guía Completa

## Estructura de Modelos

El módulo learning cuenta con los siguientes modelos organizados por responsabilidad:

### 1. **Técnicas Vocales** (`vocal-technique.model.ts`)
Define las técnicas vocales disponibles y sus variantes.

```typescript
// Importar
import { VocalTechnique, CVTMode, EVMMode, ProgressStatus } from '../models';

// Uso
const technique: VocalTechnique = {
  id: 'cvt-001',
  name: 'CVT',
  description: 'Complete Vocal Technique...',
  createdAt: new Date()
};

// Modos disponibles
const cvtMode: CVTMode = 'neutral'; // 'neutral' | 'curbing' | 'overdrive' | 'edge'
const evmMode: EVMMode = 'speech'; // 'speech' | 'sob' | 'twang' | 'belt' | 'opera'
```

### 2. **Lecciones** (`vocal-lesson.model.ts`)
Estructura de lecciones dentro de una técnica.

```typescript
import { VocalLesson, PitchRange, DynamicRange } from '../models';

const lesson: VocalLesson = {
  id: 'lesson-001',
  techniqueId: 'cvt-001',
  title: 'Neutral Posture Basics',
  description: '...',
  level: 1, // Beginner, Intermediate, Advanced
  orderIndex: 1,
  prerequisites: [],
  techniqueMode: 'neutral',
  pitchRange: {
    minMidi: 40,  // Nota más baja
    maxMidi: 84   // Nota más alta
  },
  dynamicRange: {
    minDb: -30,
    maxDb: -5
  },
  createdAt: new Date(),
  updatedAt: new Date()
};
```

### 3. **Ejercicios** (`vocal-exercise.model.ts`)
Ejercicios dentro de lecciones.

```typescript
import { VocalExercise, TargetMetrics } from '../models';

const exercise: VocalExercise = {
  id: 'exercise-001',
  techniqueId: 'cvt-001',
  name: 'Five-Tone Scale',
  description: '...',
  duration: 60, // segundos
  difficulty: 1, // 1-5
  pitchRange: { minMidi: 60, maxMidi: 74 },
  dynamicRange: { minDb: -25, maxDb: -10 },
  targetMetrics: {
    pitchAccuracy: 50, // cents
    stability: 100,    // cents
    vibratoRate: 5.5,  // Hz (opcional)
    vibratoDepth: 50   // cents (opcional)
  },
  instructions: 'Sing "ng" sound from lowest to highest note...',
  audioUrl: 'https://example.com/guides/five-tone.mp3',
  sheetMusic: 'https://example.com/sheets/five-tone.pdf',
  createdAt: new Date(),
  updatedAt: new Date()
};
```

### 4. **Progreso del Estudiante** (`student-progress.model.ts`)
Seguimiento del progreso en cada lección.

```typescript
import { StudentProgress, ProgressMetrics, ProgressStatus } from '../models';

const progress: StudentProgress = {
  id: 'prog-001',
  userId: 'user-123',
  evaluationId: 'eval-456', // Del módulo checkup
  techniqueId: 'cvt-001',
  lessonId: 'lesson-001',
  status: ProgressStatus.InProgress, // 'not_started' | 'in_progress' | 'completed'
  score: 85, // 0-100
  metrics: {
    averageAccuracy: 45,      // cents (cuánto se desvía)
    consistencyScore: 92,      // % (qué tan consistente)
    techniqueMastery: 78       // % (dominio de la técnica)
  },
  startedAt: new Date(),
  completedAt: undefined
};
```

### 5. **Intentos de Ejercicio** (`exercise-attempt.model.ts`)
Cada grabación y análisis de un ejercicio.

```typescript
import { ExerciseAttempt, AttemptFeedback } from '../models';

const attempt: ExerciseAttempt = {
  id: 'attempt-001',
  userId: 'user-123',
  exerciseId: 'exercise-001',
  progressId: 'prog-001',
  
  // Métricas medidas
  pitchAccuracy: 45,        // cents (error promedio)
  stability: 65,            // cents (variación)
  vibratoRate: 5.2,         // Hz
  vibratoDepth: 48,         // cents
  dynamicControl: 87,       // % (control del volumen)
  
  // Evaluación
  techniqueScore: 81,       // Puntuación técnica
  feedback: {
    strengths: ['Good pitch control', 'Consistent vibrato'],
    improvements: ['Work on dynamics', 'Relax jaw'],
    tips: ['Try lower volume to improve control'],
    overallComment: 'Good progress! Keep practicing.'
  },
  
  audioUrl: 'https://example.com/recordings/attempt-001.wav',
  duration: 45, // segundos
  completed: true,
  createdAt: new Date()
};
```

---

## Cómo usar los Servicios

### LearningService

```typescript
import { LearningService } from './services';

export class MyComponent {
  constructor(private learning: LearningService) {}

  async loadTechniques() {
    const techniques = await this.learning.getTechniques();
    // [{ id: 'cvt-001', name: 'CVT', ... }, { id: 'evm-001', name: 'EVM', ... }]
  }

  async loadLessons(techniqueId: string) {
    const lessons = await this.learning.getLessons(techniqueId);
    // Lecciones de esa técnica
  }

  async submitExercise(userId: string, exerciseId: string) {
    const response = await this.learning.submitAttempt({
      userId,
      exerciseId,
      progressId: 'prog-001',
      audioUrl: 'https://example.com/recording.wav',
      duration: 45,
      pitchAccuracy: 45,
      stability: 65
    });

    console.log(response.feedback); // Retroalimentación del servidor
    console.log(response.passed);   // ¿Pasó el ejercicio?
    console.log(response.score);    // Puntuación 0-100
  }
}
```

### ProgressService

```typescript
import { ProgressService } from './services';

export class ProgressComponent {
  constructor(private progress: ProgressService) {}

  async loadProgress(userId: string) {
    await this.progress.loadUserProgress(userId, 'cvt-001');
    
    // Obtener datos
    const currentProgress = this.progress.getCurrentProgress();
    const allProgress = this.progress.getAllProgress();
    
    // Calcular métricas
    const average = this.progress.getAverageScore();        // 0-100
    const completion = this.progress.getCompletionPercentage(); // 0-100
    const mastery = this.progress.calculateMasteryMetrics(); // Objeto con métricas detalladas
    
    // Verificar estado
    const isCompleted = this.progress.isLessonCompleted('lesson-001');
    const status = this.progress.getLessonStatus('lesson-001');
  }

  // Usar observables
  async initComponent() {
    await this.progress.loadUserProgress('user-123');
    
    // Se actualiza automáticamente cuando cambia el progreso
    this.progress.userProgress.subscribe(progress => {
      console.log('Progreso actualizado:', progress);
    });

    this.progress.loading.subscribe(isLoading => {
      console.log('Cargando:', isLoading);
    });

    this.progress.error.subscribe(error => {
      if (error) console.error('Error:', error);
    });
  }
}
```

---

## Flujo de Datos Típico

```
1. Usuario inicia sesión
   ↓
2. Carga técnicas disponibles (getTechniques)
   ↓
3. Elige una técnica y carga sus lecciones (getLessons)
   ↓
4. Carga el progreso del usuario (loadUserProgress)
   ↓
5. Usuario selecciona una lección y obtiene sus ejercicios
   ↓
6. Usuario graba un intento (submitAttempt)
   ↓
7. Backend analiza el audio y devuelve retroalimentación
   ↓
8. Frontend actualiza el progreso con los resultados
   ↓
9. Se calcula automáticamente: puntuación, métricas, recomendaciones
```

---

## Integración con el Módulo Checkup

El módulo learning **usa datos del módulo checkup**:

```typescript
// En StudentProgress
evaluationId: string; // Referencia a EvaluationSession del checkup

// En ExerciseAttempt feedback, se pueden usar datos de calibración:
// - SNR (Signal-to-Noise Ratio) del checkup
// - RMS de calibración
// - Latencia del sistema
```

---

## Validación de Datos

Todos los modelos están **fuertemente tipados** en TypeScript:

```typescript
// ✅ Correcto
const lesson: VocalLesson = {
  id: 'lesson-001',
  // ... resto de propiedades
};

// ❌ Error de compilación (falta 'id')
const wrongLesson: VocalLesson = {
  title: 'Test'
};

// ❌ Error de compilación (técnica inválida)
const wrongTechnique: VocalTechnique = {
  name: 'INVALID_MODE' // Solo permite 'CVT' | 'EVM'
};
```

---

## Próximos Pasos

1. **Crear componentes** para cada vista (técnicas, lecciones, ejercicios, progreso)
2. **Configurar rutas** para navegar entre vistas
3. **Implementar grabación de audio** usando Web Audio API
4. **Visualizar métricas** en gráficos y tablas
5. **Sincronizar datos** con el backend en tiempo real (WebSockets opcionales)
