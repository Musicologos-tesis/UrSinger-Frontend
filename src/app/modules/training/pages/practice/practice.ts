import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';
import { TrainingService, ExerciseDetail } from '../../services/training.service';
import { AuthService } from '../../../../services/auth.service';
import { AudioAnalyzerService } from '../../../checkup/services/audio.analyzer.service';
import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { ExerciseEngineService } from '../../services/exercise-engine.service';
import { BreathFlowHoldRules, DynamicWaveRules, ExerciseDefinition, ExerciseFrameChecks, ExerciseRuntimeState, PitchGlideRules, PitchStepsRules, PitchTargetRules } from '../../services/exercise-engine.models';
import { ExerciseRendererComponent } from '../../components/exercises/exercise-renderer/exercise-renderer.component';

type PracticeState = 'idle' | 'practicing' | 'success' | 'retry';
type SZFlowPhase = 'instructions' | 'countdown-s' | 'timing-s' | 'phase2-ready' | 'holding-z';

@Component({
  selector: 'app-practice',
  standalone: true,
  imports: [CommonModule, AuthHeaderComponent, ExerciseRendererComponent],
  templateUrl: './practice.html',
  styleUrl: './practice.scss',
})
export class PracticeComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private trainingService = inject(TrainingService);
  private authService = inject(AuthService);
  private audioService = inject(AudioAnalyzerService);
  private pitchService = inject(AudioPitchService);
  private exerciseEngine = inject(ExerciseEngineService);

  exercise = signal<ExerciseDetail | null>(null);
  isLoading = signal(true);
  error = signal<string | null>(null);

  // Practice state
  state = signal<PracticeState>('idle');
  targetNote = signal<string>('');
  targetMidi = signal<number>(0);
  remainingSeconds = signal(3);
  durationSec = signal(3);
  requiredFrames = signal(20);
  primaryCheckLabel = signal('Afinación correcta (±50 cents)');
  practicePrompt = signal('Sostén la nota objetivo');
  showTargetReference = signal(true);
  targetReferenceLabel = signal('');
  currentNote = signal<string>('-');
  currentMidi = signal<number>(0);
  currentConfidence = signal<number>(0);
  frameChecks = signal<ExerciseFrameChecks>({
    voiceDetected: false,
    edgeConfidenceOk: false,
    primaryOk: false,
  });
  breathHoldProgressPercent = signal(0);
  szFlowPhase = signal<SZFlowPhase>('instructions');
  szCountdown = signal<number>(3);
  
  private timerId: any = null;
  private animationFrameId: any = null;
  private szCountdownTimerId: any = null;
  private szSMeasureTimerId: any = null;
  private szSMeasureStartMs: number = 0;
  samples: number[] = []; // Público para el template
  private planExerciseId: string = '';
  private definition?: ExerciseDefinition;
  private runtimeState: ExerciseRuntimeState = this.exerciseEngine.createRuntimeState();
  
  Math = Math; // Para usar en el template

  async ngOnInit(): Promise<void> {
    const labExerciseKey = this.route.snapshot.paramMap.get('exerciseKey');
    const labLevelParam = this.route.snapshot.paramMap.get('level');

    if (labExerciseKey && labLevelParam) {
      const level = Number(labLevelParam);
      const exerciseData = this.createLabExercise(labExerciseKey, level);
      if (!exerciseData) {
        this.error.set('Ejercicio de laboratorio no válido');
        this.isLoading.set(false);
        return;
      }

      this.planExerciseId = exerciseData.planExerciseId;
      this.exercise.set(exerciseData);
      await this.generateRandomNote(exerciseData);
      this.isLoading.set(false);
      return;
    }

    const id = this.route.snapshot.paramMap.get('id');
    
    if (!id) {
      this.error.set('No se encontró el ID del ejercicio');
      this.isLoading.set(false);
      return;
    }

    this.planExerciseId = id;

    try {
      const exerciseData = await this.trainingService.getExerciseDetail(id);
      this.exercise.set(exerciseData);
      await this.generateRandomNote(exerciseData);
    } catch (err: any) {
      console.error('[Practice] Error al cargar ejercicio:', err);
      this.error.set('No se pudo cargar el ejercicio');
    } finally {
      this.isLoading.set(false);
    }
  }

  private createLabExercise(exerciseKey: string, level: number): ExerciseDetail | null {
    const normalizedLevel = level >= 2 ? 2 : 1;
    const catalog: Record<string, { exerciseName: string; groupName: string; description: string; instructions: string }> = {
      'breath-flow-hold': {
        exerciseName: 'Breath Flow Hold',
        groupName: 'Soporte respiratorio y control del aire',
        description: 'Mantener una nota sostenida a volumen estable',
        instructions: 'Sostén una vocal cómoda intentando mantener flujo y volumen constantes.',
      },
      's-z-balance': {
        exerciseName: 'S–Z Balance',
        groupName: 'Soporte respiratorio y control del aire',
        description: 'Controlar el flujo de aire comparando S y Z',
        instructions: 'Emite "ssss" y luego "zzzz" buscando duración y consistencia similares.',
      },
      'dynamic-wave': {
        exerciseName: 'Dynamic Wave',
        groupName: 'Soporte respiratorio y control del aire',
        description: 'Patrón dinámico suave→fuerte→suave en una misma nota',
        instructions: 'Mantén una nota y completa 3 repeticiones del patrón suave→fuerte→suave en máximo 1 minuto.',
      },
      'pitch-target': {
        exerciseName: 'Pitch Target',
        groupName: 'Afinación y oído tonal',
        description: 'Coincidir y sostener la nota objetivo en repeticiones',
        instructions: 'Mantén la nota objetivo durante 3 segundos y completa 3 repeticiones.',
      },
      'pitch-steps': {
        exerciseName: 'Pitch Steps',
        groupName: 'Afinación y oído tonal',
        description: 'Mejorar precisión entre notas consecutivas',
        instructions: 'Canta dos notas en secuencia manteniendo el intervalo indicado.',
      },
      'pitch-glide': {
        exerciseName: 'Pitch Glide',
        groupName: 'Afinación y oído tonal',
        description: 'Barrido controlado entre dos notas objetivo',
        instructions: 'Completa 3 repeticiones: desliza de Nota 1 a Nota 2 y regresa a Nota 1 en máximo 1 minuto.',
      },
      'steady-tone': {
        exerciseName: 'Steady Tone',
        groupName: 'Estabilidad y vibrato controlado',
        description: 'Mantener una nota estable',
        instructions: 'Sostén una nota cómoda evitando fluctuaciones.',
      },
      'controlled-vibrato': {
        exerciseName: 'Controlled vibrato',
        groupName: 'Estabilidad y vibrato controlado',
        description: 'Generar vibrato controlado y regular',
        instructions: 'Sostén una nota y aplica vibrato suave y uniforme.',
      },
      'clean-onset': {
        exerciseName: 'Clean onset',
        groupName: 'Estabilidad y vibrato controlado',
        description: 'Iniciar la nota con precisión',
        instructions: 'Inicia directamente en la afinación objetivo sin ataque brusco.',
      },
      'single-burst': {
        exerciseName: 'Single Burst',
        groupName: 'Potencia y control dinámico',
        description: 'Ataque energético controlado',
        instructions: 'Realiza una emisión firme manteniendo estabilidad de tono.',
      },
      'volume-rise': {
        exerciseName: 'Volume Rise',
        groupName: 'Potencia y control dinámico',
        description: 'Subir volumen sin perder tono',
        instructions: 'Comienza suave y aumenta gradualmente volumen manteniendo afinación.',
      },
      'loud-soft-alternance': {
        exerciseName: 'Loud–Soft Alternance',
        groupName: 'Potencia y control dinámico',
        description: 'Alternar suave y fuerte',
        instructions: 'Alterna intensidad sin cambiar la nota base.',
      },
      'vocal-glide': {
        exerciseName: 'Vocal glide',
        groupName: 'Rango y flexibilidad vocal',
        description: 'Sirena vocal para transición de registros',
        instructions: 'Desliza de grave a agudo y vuelve, sin forzar.',
      },
      'step-expansion': {
        exerciseName: 'Step Expansion',
        groupName: 'Rango y flexibilidad vocal',
        description: 'Secuencia ascendente y descendente',
        instructions: 'Canta la escala corta manteniendo color y volumen.',
      },
      'mix-coordination': {
        exerciseName: 'Mix coordination',
        groupName: 'Rango y flexibilidad vocal',
        description: 'Coordinar transición de pecho a cabeza',
        instructions: 'Cruza zona mixta con una sirena corta manteniendo homogeneidad.',
      },
    };

    const selected = catalog[exerciseKey];
    if (!selected) {
      return null;
    }

    return {
      planExerciseId: `lab-${exerciseKey}-l${normalizedLevel}`,
      exerciseLevelId: 0,
      exerciseId: 0,
      exerciseName: selected.exerciseName,
      groupNumber: 0,
      groupName: selected.groupName,
      level: normalizedLevel,
      description: selected.description,
      instructions: selected.instructions,
      videoUrl: null,
      cvtDescription: null,
      evmDescription: null,
      completionCount: 0,
      completedDates: [],
      isCompletedThisWeek: false,
    };
  }

  private async generateRandomNote(exercise?: ExerciseDetail): Promise<void> {
    // Obtener rango vocal del usuario desde backend
    let minMidi = 48; // C3 por defecto
    let maxMidi = 72; // C5 por defecto

    const profileId = localStorage.getItem('profile_id');
    if (profileId) {
      try {
        const latestRange = await this.trainingService.getLatestVocalRange(profileId);
        if (latestRange?.vocalRange?.minMidi && latestRange?.vocalRange?.maxMidi) {
          minMidi = Math.round(latestRange.vocalRange.minMidi);
          maxMidi = Math.round(latestRange.vocalRange.maxMidi);
        }
      } catch (e) {
        console.warn('[Practice] No se pudo obtener rango vocal desde backend, usando valores por defecto');
      }
    }

    // Generar nota aleatoria dentro del rango (evitando extremos)
    // Para Pitch Steps, reservamos espacio hacia arriba para el intervalo del nivel.
    const exerciseName = (exercise?.exerciseName ?? '').toLowerCase();
    const isBreathFlowHold = exerciseName.includes('breath flow hold');
    const isPitchTarget = exerciseName.includes('pitch target');
    const isDynamicWave = exerciseName.includes('dynamic wave');
    const isPitchSteps = exerciseName.includes('pitch steps');
    const isStepExpansion = exerciseName.includes('step expansion');
    const isMixCoordination = exerciseName.includes('mix coordination');
    const isVocalGlide = exerciseName.includes('vocal glide');
    const isPitchGlide = exerciseName.includes('pitch glide');
    const intervalSemitones = isPitchSteps
      ? ((exercise?.level ?? 1) >= 2 ? 5 : 2)
      : isStepExpansion
      ? ((exercise?.level ?? 1) >= 2 ? 5 : 3)
      : isMixCoordination
      ? ((exercise?.level ?? 1) >= 2 ? 5 : 3)
      : isVocalGlide
      ? ((exercise?.level ?? 1) >= 2 ? 8 : 5)
      : isPitchGlide
      ? ((exercise?.level ?? 1) >= 2 ? 6 : 3)
      : 0;

    const margin = 3; // Evitar 3 semitonos de los extremos
    const safeMin = minMidi + margin;
    const safeMax = Math.max(safeMin, maxMidi - margin - intervalSemitones);

    if (isBreathFlowHold) {
      const mid = Math.round((minMidi + maxMidi) / 2);
      const targetMidi = (exercise?.level ?? 1) >= 2 ? mid + 3 : mid;
      const clamped = Math.max(safeMin, Math.min(maxMidi - margin, targetMidi));
      this.targetMidi.set(clamped);
      this.targetNote.set(this.pitchService.midiToNoteName(clamped));
      this.applyIdleTargetPreview();
      return;
    }

    if (isDynamicWave) {
      const level = exercise?.level ?? 1;
      const comfortableMidi = Math.round((minMidi + maxMidi) / 2);
      const highMidi = Math.max(safeMin, maxMidi - 1);
      const targetMidi = level >= 2 ? highMidi : comfortableMidi;
      const clamped = Math.max(safeMin, Math.min(maxMidi - margin, targetMidi));
      this.targetMidi.set(clamped);
      this.targetNote.set(this.pitchService.midiToNoteName(clamped));
      this.applyIdleTargetPreview();
      return;
    }

    if (isPitchTarget) {
      const level = exercise?.level ?? 1;
      const comfortableMidi = Math.round((minMidi + maxMidi) / 2);
      const highMidi = Math.max(safeMin, maxMidi - 1);
      const targetMidi = level >= 2 ? highMidi : comfortableMidi;
      const clamped = Math.max(safeMin, Math.min(maxMidi - margin, targetMidi));
      this.targetMidi.set(clamped);
      this.targetNote.set(this.pitchService.midiToNoteName(clamped));
      this.applyIdleTargetPreview();
      return;
    }

    const randomMidi = Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;

    this.targetMidi.set(randomMidi);
    this.targetNote.set(this.pitchService.midiToNoteName(randomMidi));
    this.applyIdleTargetPreview();
  }

  async startPractice(): Promise<void> {
    this.error.set(null);

    const exercise = this.exercise();
    try {
      this.definition = this.exerciseEngine.createDefinitionFromExercise({
        id: exercise?.planExerciseId ?? this.planExerciseId,
        exerciseName: exercise?.exerciseName ?? 'Pitch Target',
        level: exercise?.level ?? 1,
        targetMidi: this.targetMidi(),
      });
    } catch (err: any) {
      this.error.set(err?.message || 'Este tipo de ejercicio aún no está implementado.');
      this.state.set('idle');
      return;
    }

    this.durationSec.set(this.definition.durationSec);
    this.requiredFrames.set(this.definition.rules.minSamples);
    this.primaryCheckLabel.set(this.exerciseEngine.getPrimaryCheckLabel(this.definition));
    this.showTargetReference.set(this.exerciseEngine.shouldShowTargetReference(this.definition));
    this.runtimeState = this.exerciseEngine.createRuntimeState();

    const targetReference = this.exerciseEngine.getTargetReferenceLabel(this.definition, this.runtimeState);
    this.targetReferenceLabel.set(targetReference ?? '');

    const currentTargetMidi = this.exerciseEngine.getCurrentTargetMidi(this.definition, this.runtimeState);
    if (currentTargetMidi) {
      this.targetMidi.set(currentTargetMidi);
      this.targetNote.set(this.pitchService.midiToNoteName(currentTargetMidi));
    }

    this.practicePrompt.set(
      this.exerciseEngine.getPracticePrompt(this.definition, this.targetNote(), this.runtimeState)
    );

    if (this.definition.kind === 's-z-balance') {
      this.startSZFlow();
      return;
    }

    this.state.set('practicing');
    this.remainingSeconds.set(this.definition.durationSec);
    this.samples = [];
    this.frameChecks.set({
      voiceDetected: false,
      edgeConfidenceOk: false,
      primaryOk: false,
    });
    this.breathHoldProgressPercent.set(0);

    try {
      // Verificar/inicializar micrófono
      let analyser = this.audioService.getAnalyser();
      if (!analyser) {
        console.log('[Practice] Inicializando micrófono...');
        await this.audioService.requestMic();
        analyser = this.audioService.getAnalyser();
        if (!analyser) {
          throw new Error('No se pudo inicializar el micrófono.');
        }
      }

      // CRÍTICO: Inicializar pitchService con el analyser
      await this.pitchService.initialize(analyser);
      console.log('[Practice] PitchService inicializado');

      // Iniciar captura de audio
      this.startAudioCapture();
      this.startTimer();
    } catch (err: any) {
      console.error('[Practice] Error al iniciar:', err);
      this.error.set(err?.message || 'Error al iniciar la práctica.');
      this.state.set('idle');
    }
  }

  private startSZFlow(): void {
    this.state.set('practicing');
    this.samples = [];
    this.runtimeState.szPhase = 's';
    this.runtimeState.szSPhaseDurationMs = 0;
    this.runtimeState.szZPhaseDurationMs = 0;
    this.runtimeState.szZRequiredDurationMs = 0;
    this.runtimeState.szZMaxDurationMs = 0;
    this.runtimeState.szZStartMs = null;
    this.runtimeState.szLastValidFrameMs = null;
    this.runtimeState.szSamplesZ = 0;
    this.frameChecks.set({
      voiceDetected: false,
      edgeConfidenceOk: false,
      primaryOk: false,
    });
    this.currentNote.set('-');
    this.currentMidi.set(0);
    this.currentConfidence.set(0);
    this.remainingSeconds.set(0);
    this.szFlowPhase.set('countdown-s');
    this.szCountdown.set(3);
    this.practicePrompt.set('Respira profundo. Comenzamos en...');
    this.runSZCountdownToSPhase();
  }

  private runSZCountdownToSPhase(): void {
    this.clearSZTimers();
    this.szCountdownTimerId = setInterval(() => {
      const value = this.szCountdown();
      if (value <= 1) {
        clearInterval(this.szCountdownTimerId);
        this.szCountdownTimerId = null;
        this.beginSZSPhaseTiming();
        return;
      }
      this.szCountdown.set(value - 1);
    }, 1000);
  }

  private beginSZSPhaseTiming(): void {
    this.szFlowPhase.set('timing-s');
    this.practicePrompt.set('Fase S: haz "S" y detén cuando ya no puedas sostenerla.');
    this.szSMeasureStartMs = performance.now();
    this.szSMeasureTimerId = setInterval(() => {
      const elapsedMs = Math.max(0, performance.now() - this.szSMeasureStartMs);
      this.runtimeState.szSPhaseDurationMs = elapsedMs;
      this.remainingSeconds.set(Math.round(elapsedMs / 100) / 10);
    }, 100);
  }

  stopSZSPhase(): void {
    if (this.state() !== 'practicing' || this.szFlowPhase() !== 'timing-s' || !this.definition || this.definition.kind !== 's-z-balance') {
      return;
    }

    if (this.szSMeasureTimerId) {
      clearInterval(this.szSMeasureTimerId);
      this.szSMeasureTimerId = null;
    }

    const measuredMs = Math.max(1000, this.runtimeState.szSPhaseDurationMs);
    this.runtimeState.szSPhaseDurationMs = measuredMs;
    this.runtimeState.szZRequiredDurationMs = measuredMs;
    this.runtimeState.szZMaxDurationMs = measuredMs + this.definition.rules.maxExtraHoldSeconds * 1000;
    this.runtimeState.szPhase = 'z';
    this.szFlowPhase.set('phase2-ready');
    this.practicePrompt.set(
      `Ahora mantén ${this.targetNote()} durante ${(measuredMs / 1000).toFixed(1)}s (máximo ${Math.round(this.runtimeState.szZMaxDurationMs / 1000)}s).`
    );
    this.remainingSeconds.set(Math.round(measuredMs / 100) / 10);
  }

  async startSZHoldPhase(): Promise<void> {
    if (!this.definition || this.definition.kind !== 's-z-balance' || this.szFlowPhase() !== 'phase2-ready') {
      return;
    }

    this.szFlowPhase.set('holding-z');
    this.samples = [];
    this.runtimeState.szZPhaseDurationMs = 0;
    this.runtimeState.szSamplesZ = 0;
    this.runtimeState.szZStartMs = performance.now();
    this.runtimeState.szLastValidFrameMs = null;
    this.remainingSeconds.set(Math.max(1, Math.ceil(this.runtimeState.szZMaxDurationMs / 1000)));

    try {
      let analyser = this.audioService.getAnalyser();
      if (!analyser) {
        await this.audioService.requestMic();
        analyser = this.audioService.getAnalyser();
        if (!analyser) {
          throw new Error('No se pudo inicializar el micrófono.');
        }
      }

      await this.pitchService.initialize(analyser);
      this.startAudioCapture();
      this.startTimer();
    } catch (err: any) {
      this.error.set(err?.message || 'Error al iniciar la fase de nota.');
      this.state.set('idle');
    }
  }

  private startAudioCapture(): void {
    const capture = async () => {
      if (this.state() !== 'practicing') {
        return;
      }

      if (this.definition?.kind === 's-z-balance' && this.szFlowPhase() !== 'holding-z') {
        return;
      }

      const analyser = this.audioService.getAnalyser();
      if (!analyser) return;

      const result = await this.pitchService.detectPitch();
      const rms = this.pitchService.calculateRMS();

      if (!result) {
        this.currentNote.set('-');
        this.currentMidi.set(0);
        this.currentConfidence.set(0);
        this.frameChecks.set({
          voiceDetected: false,
          edgeConfidenceOk: false,
          primaryOk: false,
        });

        this.animationFrameId = requestAnimationFrame(capture);
        return;
      }

      if (result) {
        const { midiNote, frequency, confidence } = result;
        this.currentConfidence.set(confidence);
        
        if (!this.definition) {
          return;
        }

        const evaluation = this.exerciseEngine.evaluateFrame(
          {
            timestamp: performance.now(),
            midiNote,
            frequency,
            confidence,
            rms,
          },
          this.definition,
          this.runtimeState
        );

        this.frameChecks.set(evaluation.checks);

        const shouldShowDetectedNote =
          evaluation.checks.voiceDetected &&
          evaluation.checks.edgeConfidenceOk &&
          midiNote > 0;

        if (shouldShowDetectedNote) {
          this.currentMidi.set(midiNote);
          this.currentNote.set(this.pitchService.midiToNoteName(midiNote));
        } else {
          this.currentMidi.set(0);
          this.currentNote.set('-');
        }

        if (this.definition.kind === 'breath-flow-hold') {
          const rules = this.definition.rules as BreathFlowHoldRules;
          const holdPct = rules.requiredHoldMs > 0
            ? Math.min(100, (this.runtimeState.breathHoldMaxMs / rules.requiredHoldMs) * 100)
            : 0;
          this.breathHoldProgressPercent.set(holdPct);
        }

        const activeTargetMidi = this.exerciseEngine.getCurrentTargetMidi(this.definition, this.runtimeState);
        if (activeTargetMidi) {
          this.targetMidi.set(activeTargetMidi);
          this.targetNote.set(this.pitchService.midiToNoteName(activeTargetMidi));
        }

        const targetReference = this.exerciseEngine.getTargetReferenceLabel(this.definition, this.runtimeState);
        this.targetReferenceLabel.set(targetReference ?? '');
        this.practicePrompt.set(
          this.exerciseEngine.getPracticePrompt(this.definition, this.targetNote(), this.runtimeState)
        );

        if (evaluation.isValidFrame) {
          this.samples.push(midiNote);

          if (
            this.definition.kind === 'breath-flow-hold' ||
            this.definition.kind === 's-z-balance' ||
            this.definition.kind === 'dynamic-wave' ||
            this.definition.kind === 'pitch-target' ||
            this.definition.kind === 'pitch-steps' ||
            this.definition.kind === 'pitch-glide'
          ) {
            const earlyResult = this.exerciseEngine.buildResult(
              this.samples.length,
              this.definition,
              this.runtimeState
            );
            if (earlyResult.passed) {
              this.finishPractice();
              return;
            }
          }
        }
      }

      this.animationFrameId = requestAnimationFrame(capture);
    };

    capture();
  }

  private startTimer(): void {
    this.clearTimer();
    this.timerId = setInterval(() => {
      if (this.definition?.kind === 's-z-balance' && this.runtimeState.szZStartMs) {
        const elapsedMs = performance.now() - this.runtimeState.szZStartMs;
        const remaining = Math.max(0, Math.ceil((this.runtimeState.szZMaxDurationMs - elapsedMs) / 1000));
        this.remainingSeconds.set(remaining);
        if (remaining <= 0) {
          this.finishPractice();
        }
        return;
      }

      const current = this.remainingSeconds();
      if (current <= 1) {
        this.finishPractice();
      } else {
        this.remainingSeconds.set(current - 1);
      }
    }, 1000);
  }

  private clearTimer(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.clearSZTimers();
  }

  private clearSZTimers(): void {
    if (this.szCountdownTimerId) {
      clearInterval(this.szCountdownTimerId);
      this.szCountdownTimerId = null;
    }
    if (this.szSMeasureTimerId) {
      clearInterval(this.szSMeasureTimerId);
      this.szSMeasureTimerId = null;
    }
  }

  private finishPractice(): void {
    this.clearTimer();

    const result = this.definition
      ? this.exerciseEngine.buildResult(this.samples.length, this.definition, this.runtimeState)
      : {
          passed: false,
          validFrames: this.samples.length,
          requiredFrames: this.requiredFrames(),
          completionRatio: 0,
          score: 0,
        };

    const success = result.passed;

    console.log('[Practice] Muestras válidas:', result.validFrames, '/', result.requiredFrames);
    console.log('[Practice] Score:', result.score + '%');
    console.log('[Practice] Resultado:', success ? 'ÉXITO' : 'REINTENTAR');

    this.state.set(success ? 'success' : 'retry');
  }

  retryPractice(): void {
    this.error.set(null);
    this.clearTimer();
    this.state.set('idle');
    this.szFlowPhase.set('instructions');
    this.szCountdown.set(3);
    this.samples = [];
    this.currentNote.set('-');
    this.currentMidi.set(0);
    this.currentConfidence.set(0);
    this.targetReferenceLabel.set('');
    this.frameChecks.set({
      voiceDetected: false,
      edgeConfidenceOk: false,
      primaryOk: false,
    });
    this.breathHoldProgressPercent.set(0);
    this.applyIdleTargetPreview();
  }

  isBreathFlowHold(): boolean {
    return !!this.definition && this.definition.kind === 'breath-flow-hold';
  }

  isSZBalance(): boolean {
    return !!this.definition && this.definition.kind === 's-z-balance';
  }

  isDynamicWave(): boolean {
    return !!this.definition && this.definition.kind === 'dynamic-wave';
  }

  isPitchTarget(): boolean {
    return !!this.definition && this.definition.kind === 'pitch-target';
  }

  isPitchSteps(): boolean {
    return !!this.definition && this.definition.kind === 'pitch-steps';
  }

  isPitchGlide(): boolean {
    return !!this.definition && this.definition.kind === 'pitch-glide';
  }

  isCompletionRequirementMet(): boolean {
    if (this.isBreathFlowHold()) {
      return this.breathHoldProgressPercent() >= 100;
    }
    if (this.isSZBalance()) {
      return this.runtimeState.szPhase === 'complete';
    }
    if (this.isDynamicWave() && this.definition) {
      const rules = this.definition.rules as DynamicWaveRules;
      return this.runtimeState.dynamicCyclesCompleted >= rules.requiredCycles;
    }
    if (this.isPitchTarget() && this.definition) {
      const rules = this.definition.rules as PitchTargetRules;
      return this.runtimeState.pitchTargetRepetitions >= rules.requiredRepetitions;
    }
    if (this.isPitchSteps() && this.definition) {
      const rules = this.definition.rules as PitchStepsRules;
      return this.runtimeState.pitchStepsRepetitions >= rules.requiredRepetitions;
    }
    if (this.isPitchGlide() && this.definition) {
      const rules = this.definition.rules as PitchGlideRules;
      return this.runtimeState.pitchGlideRepetitions >= rules.requiredRepetitions;
    }
    return this.samples.length >= this.requiredFrames();
  }

  getLiveProgressPercent(): number {
    if (this.isBreathFlowHold()) {
      return Math.min(100, Math.round(this.breathHoldProgressPercent()));
    }
    if (this.isSZBalance()) {
      const requiredMs = Math.max(1, this.runtimeState.szZRequiredDurationMs);
      const zMs = this.runtimeState.szZPhaseDurationMs;
      return Math.min(100, Math.round((zMs / requiredMs) * 100));
    }
    if (this.isDynamicWave() && this.definition) {
      const rules = this.definition.rules as DynamicWaveRules;
      const cycles = this.runtimeState.dynamicCyclesCompleted;
      const partial = this.runtimeState.dynamicPhase === 'fall' ? 0.5 : 0;
      const progress = (cycles + partial) / Math.max(1, rules.requiredCycles);
      return Math.min(100, Math.round(progress * 100));
    }
    if (this.isPitchTarget() && this.definition) {
      const rules = this.definition.rules as PitchTargetRules;
      const holdProgress = Math.min(1, this.runtimeState.pitchTargetCurrentHoldMs / rules.holdDurationMs);
      return Math.min(100, Math.round(holdProgress * 100));
    }
    if (this.isPitchSteps() && this.definition) {
      const rules = this.definition.rules as PitchStepsRules;
      const stepProgress = this.runtimeState.currentStepIndex + Math.min(1, this.runtimeState.pitchStepsCurrentHoldMs / rules.noteHoldMs);
      return Math.min(100, Math.round((stepProgress / 2) * 100));
    }
    if (this.isPitchGlide() && this.definition) {
      const rules = this.definition.rules as PitchGlideRules;
      const phaseProgress =
        this.runtimeState.glidePhase === 'down'
          ? 0.5
          : this.runtimeState.glidePhase === 'complete'
          ? 1
          : 0;
      const totalProgress = (this.runtimeState.pitchGlideRepetitions + phaseProgress) / Math.max(1, rules.requiredRepetitions);
      return Math.min(100, Math.round(totalProgress * 100));
    }
    if (this.requiredFrames() <= 0) return 0;
    return Math.min(100, Math.round((this.samples.length / this.requiredFrames()) * 100));
  }

  getCompletionCheckLabel(): string {
    if (this.isBreathFlowHold() && this.definition) {
      const rules = this.definition.rules as BreathFlowHoldRules;
      return `Sostén continuo (${Math.round(rules.requiredHoldMs / 1000)} segundos)`;
    }
    if (this.isSZBalance()) {
      const sec = Math.max(0, this.runtimeState.szZRequiredDurationMs / 1000);
      return `Mantén la nota durante ${sec.toFixed(1)} segundos`;
    }
    if (this.isDynamicWave() && this.definition) {
      const rules = this.definition.rules as DynamicWaveRules;
      return `Repeticiones detectadas (${this.runtimeState.dynamicCyclesCompleted}/${rules.requiredCycles})`;
    }
    if (this.isPitchTarget() && this.definition) {
      const rules = this.definition.rules as PitchTargetRules;
      return `Repeticiones completadas (${this.runtimeState.pitchTargetRepetitions}/${rules.requiredRepetitions})`;
    }
    if (this.isPitchSteps() && this.definition) {
      const rules = this.definition.rules as PitchStepsRules;
      return `Repeticiones completadas (${this.runtimeState.pitchStepsRepetitions}/${rules.requiredRepetitions})`;
    }
    if (this.isPitchGlide() && this.definition) {
      const rules = this.definition.rules as PitchGlideRules;
      return `Repeticiones completadas (${this.runtimeState.pitchGlideRepetitions}/${rules.requiredRepetitions})`;
    }
    return `Duración suficiente (${this.durationSec()} segundos)`;
  }

  getSZRecordedDurationSec(): number {
    return Math.max(0, this.runtimeState.szSPhaseDurationMs / 1000);
  }

  getSZCurrentZDurationSec(): number {
    return Math.max(0, this.runtimeState.szZPhaseDurationMs / 1000);
  }

  getSZFlowPhase(): SZFlowPhase {
    return this.szFlowPhase();
  }

  getSZCountdownValue(): number {
    return this.szCountdown();
  }

  getExerciseKindForView(): string {
    if (this.definition) {
      return this.definition.kind;
    }

    const name = (this.exercise()?.exerciseName ?? '').toLowerCase();
    if (name.includes('breath flow hold')) return 'breath-flow-hold';
    if (name.includes('s–z balance') || name.includes('s-z balance')) return 's-z-balance';
    if (name.includes('dynamic wave')) return 'dynamic-wave';
    if (name.includes('pitch target')) return 'pitch-target';
    if (name.includes('pitch steps')) return 'pitch-steps';
    if (name.includes('pitch glide') || name.includes('vocal glide')) return 'pitch-glide';
    return 'default';
  }

  private getSequenceMidisForExercise(): number[] | null {
    if (this.definition?.kind === 'pitch-steps') {
      const rules = this.definition.rules as PitchStepsRules;
      return [rules.startMidi, rules.endMidi];
    }

    if (this.definition?.kind === 'pitch-glide') {
      const rules = this.definition.rules as PitchGlideRules;
      return [rules.startMidi, rules.endMidi, rules.startMidi];
    }

    const exercise = this.exercise();
    if (!exercise) return null;

    const startMidi = this.targetMidi();
    if (startMidi <= 0) return null;

    const name = exercise.exerciseName.toLowerCase();
    const level = exercise.level ?? 1;

    if (name.includes('pitch steps')) {
      const interval = level >= 2 ? 5 : 2;
      return [startMidi, startMidi + interval];
    }

    if (name.includes('pitch glide')) {
      const interval = level >= 2 ? 6 : 3;
      return [startMidi, startMidi + interval, startMidi];
    }

    if (name.includes('vocal glide')) {
      const interval = level >= 2 ? 8 : 5;
      return [startMidi, startMidi + interval, startMidi];
    }

    return null;
  }

  private applyIdleTargetPreview(): void {
    const sequenceMidis = this.getSequenceMidisForExercise();
    if (!sequenceMidis || sequenceMidis.length <= 1) {
      this.targetReferenceLabel.set('');
      return;
    }

    const labels = sequenceMidis.map((midi) => this.pitchService.midiToNoteName(midi));
    this.targetReferenceLabel.set(labels.join(' → '));
  }

  async finishExercise(): Promise<void> {
    try {
      // Marcar ejercicio como completado
      await this.trainingService.completeExercise(this.planExerciseId);
      
      // Navegar de vuelta al dashboard
      this.router.navigate(['/training/dashboard']);
    } catch (error) {
      console.error('[Practice] Error al completar ejercicio:', error);
      // Navegar de todas formas
      this.router.navigate(['/training/dashboard']);
    }
  }

  playTargetNote(): void {
    if (this.definition?.kind === 'pitch-steps') {
      const rules = this.definition.rules as PitchStepsRules;
      const first = this.pitchService.midiToFrequency(rules.startMidi);
      const second = this.pitchService.midiToFrequency(rules.endMidi);
      this.playFrequencySequence([first, second], 1.0, 0.12);
      return;
    }

    if (this.definition?.kind === 'pitch-glide') {
      const rules = this.definition.rules as PitchGlideRules;
      const first = this.pitchService.midiToFrequency(rules.startMidi);
      const second = this.pitchService.midiToFrequency(rules.endMidi);
      this.playFrequencySequence([first, second, first], 0.9, 0.1);
      return;
    }

    const previewSequence = this.getSequenceMidisForExercise();
    if (previewSequence && previewSequence.length > 1) {
      const frequencies = previewSequence.map((midi) => this.pitchService.midiToFrequency(midi));
      if (previewSequence.length === 2) {
        this.playFrequencySequence(frequencies, 1.0, 0.12);
      } else {
        this.playFrequencySequence(frequencies, 0.9, 0.1);
      }
      return;
    }

    const frequency = this.pitchService.midiToFrequency(this.targetMidi());
    if (frequency === 0) return;
    this.playFrequencySequence([frequency], 1.0, 0);
  }

  private playFrequencySequence(frequencies: number[], toneSec: number, gapSec: number): void {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = audioContext.currentTime;

      frequencies.forEach((frequency, idx) => {
        const start = now + idx * (toneSec + gapSec);
        const end = start + toneSec;

        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;

        gainNode.gain.setValueAtTime(0, start);
        gainNode.gain.linearRampToValueAtTime(0.3, start + 0.08);
        gainNode.gain.setValueAtTime(0.3, Math.max(start + 0.08, end - 0.08));
        gainNode.gain.linearRampToValueAtTime(0, end);

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(end);

        oscillator.onended = () => {
          oscillator.disconnect();
          gainNode.disconnect();
        };
      });

      const totalDurationMs = Math.ceil((frequencies.length * toneSec + Math.max(0, frequencies.length - 1) * gapSec) * 1000) + 120;
      setTimeout(() => void audioContext.close(), totalDurationMs);
    } catch (error) {
      console.error('[Practice] Error al reproducir nota:', error);
    }
  }

  goToTraining(): void {
    this.router.navigate(['/training/dashboard']);
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

  ngOnDestroy(): void {
    this.clearTimer();
    this.audioService.stop();
  }
}
