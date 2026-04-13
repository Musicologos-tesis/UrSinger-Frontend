import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';
import { TrainingService, ExerciseDetail } from '../../services/training.service';
import { AuthService } from '../../../../services/auth.service';
import { AudioAnalyzerService } from '../../../checkup/services/audio.analyzer.service';
import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { ExerciseEngineService } from '../../services/exercise-engine.service';
import { ExerciseDefinition, ExerciseFrameChecks, ExerciseRuntimeState } from '../../services/exercise-engine.models';

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
  
  private timerId: any = null;
  private animationFrameId: any = null;
  samples: number[] = []; // Público para el template
  private planExerciseId: string = '';
  private definition?: ExerciseDefinition;
  private runtimeState: ExerciseRuntimeState = this.exerciseEngine.createRuntimeState();
  
  Math = Math; // Para usar en el template

  async ngOnInit(): Promise<void> {
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
      this.generateRandomNote(exerciseData);
    } catch (err: any) {
      console.error('[Practice] Error al cargar ejercicio:', err);
      this.error.set('No se pudo cargar el ejercicio');
    } finally {
      this.isLoading.set(false);
    }
  }

  private generateRandomNote(exercise?: ExerciseDetail): void {
    // Obtener rango vocal del usuario desde localStorage
    const metricsStr = localStorage.getItem('ursinger.metrics.partial');
    let minMidi = 48; // C3 por defecto
    let maxMidi = 72; // C5 por defecto

    if (metricsStr) {
      try {
        const metrics = JSON.parse(metricsStr);
        if (metrics.rangeMinMidi && metrics.rangeMaxMidi) {
          minMidi = Math.round(metrics.rangeMinMidi);
          maxMidi = Math.round(metrics.rangeMaxMidi);
        }
      } catch (e) {
        console.warn('[Practice] No se pudo obtener rango vocal, usando valores por defecto');
      }
    }

    // Generar nota aleatoria dentro del rango (evitando extremos)
    // Para Pitch Steps, reservamos espacio hacia arriba para el intervalo del nivel.
    const exerciseName = (exercise?.exerciseName ?? '').toLowerCase();
    const isPitchSteps = exerciseName.includes('pitch steps');
    const isPitchGlide = exerciseName.includes('pitch glide') || exerciseName.includes('vocal glide');
    const intervalSemitones = isPitchSteps
      ? ((exercise?.level ?? 1) >= 2 ? 5 : 2)
      : isPitchGlide
      ? ((exercise?.level ?? 1) >= 2 ? 6 : 3)
      : 0;

    const margin = 3; // Evitar 3 semitonos de los extremos
    const safeMin = minMidi + margin;
    const safeMax = Math.max(safeMin, maxMidi - margin - intervalSemitones);
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
