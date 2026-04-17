import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';
import { TrainingService, ExerciseDetail } from '../../services/training.service';
import { AuthService } from '../../../../services/auth.service';
import { AudioAnalyzerService } from '../../../checkup/services/audio.analyzer.service';
import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { ExerciseEngineService } from '../../services/exercise-engine.service';
import { BreathFlowHoldRules, ExerciseDefinition, ExerciseFrameChecks, ExerciseRuntimeState } from '../../services/exercise-engine.models';

type PracticeState = 'idle' | 'practicing' | 'success' | 'retry';

@Component({
  selector: 'app-practice',
  standalone: true,
  imports: [CommonModule, AuthHeaderComponent],
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
  
  private timerId: any = null;
  private animationFrameId: any = null;
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
        description: 'Control dinámico suave→fuerte→suave',
        instructions: 'Canta una vocal, sube ligeramente volumen y vuelve al volumen inicial.',
      },
      'pitch-target': {
        exerciseName: 'Pitch Target',
        groupName: 'Afinación y oído tonal',
        description: 'Coincidir la nota emitida con una referencia',
        instructions: 'Escucha la nota guía y cántala intentando igualarla.',
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
        description: 'Deslizamientos suaves sin saltos bruscos',
        instructions: 'Desliza la voz de grave a agudo y regresa de forma continua.',
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
      return;
    }

    const randomMidi = Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;

    this.targetMidi.set(randomMidi);
    this.targetNote.set(this.pitchService.midiToNoteName(randomMidi));
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

  private startAudioCapture(): void {
    const capture = async () => {
      if (this.state() !== 'practicing') {
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
        
        // Actualizar visualización en tiempo real
        if (midiNote > 0) {
          const noteName = this.pitchService.midiToNoteName(midiNote);
          this.currentNote.set(noteName);
          this.currentMidi.set(midiNote);
          this.currentConfidence.set(confidence);
        } else {
          this.currentNote.set('-');
          this.currentMidi.set(0);
          this.currentConfidence.set(0);
        }
        
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

          if (this.definition.kind === 'breath-flow-hold') {
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
    this.state.set('idle');
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
  }

  isBreathFlowHold(): boolean {
    return !!this.definition && this.definition.kind === 'breath-flow-hold';
  }

  isCompletionRequirementMet(): boolean {
    if (this.isBreathFlowHold()) {
      return this.breathHoldProgressPercent() >= 100;
    }
    return this.samples.length >= this.requiredFrames();
  }

  getLiveProgressPercent(): number {
    if (this.isBreathFlowHold()) {
      return Math.min(100, Math.round(this.breathHoldProgressPercent()));
    }
    if (this.requiredFrames() <= 0) return 0;
    return Math.min(100, Math.round((this.samples.length / this.requiredFrames()) * 100));
  }

  getCompletionCheckLabel(): string {
    if (this.isBreathFlowHold() && this.definition) {
      const rules = this.definition.rules as BreathFlowHoldRules;
      return `Sostén continuo (${Math.round(rules.requiredHoldMs / 1000)} segundos)`;
    }
    return `Duración suficiente (${this.durationSec()} segundos)`;
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
    const frequency = this.pitchService.midiToFrequency(this.targetMidi());
    if (frequency === 0) return;

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.1);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.9);
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 1.0);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 1.0);
      
      setTimeout(() => {
        oscillator.disconnect();
        gainNode.disconnect();
        audioContext.close();
      }, 1100);
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
