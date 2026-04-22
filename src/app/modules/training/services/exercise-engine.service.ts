import { Injectable, inject } from '@angular/core';
import { VoiceDetectionService } from '../../../services/voice-detection.service';
import { AudioPitchService } from '../../checkup/services/audio-pitch.service';
import { resolveExerciseKindFromName } from './exercise-engine.config';
import { PitchTargetStrategy } from './strategies/pitch-target.strategy';
import { SteadyToneStrategy } from './strategies/steady-tone.strategy';
import { PitchStepsStrategy } from './strategies/pitch-steps.strategy';
import { PitchGlideStrategy } from './strategies/pitch-glide.strategy';
import { BreathFlowHoldStrategy } from './strategies/breath-flow-hold.strategy';
import { SZBalanceStrategy } from './strategies/s-z-balance.strategy';
import { DynamicWaveStrategy } from './strategies/dynamic-wave.strategy';
import { VolumeRiseStrategy } from './strategies/volume-rise.strategy';
import { LoudSoftAlternanceStrategy } from './strategies/loud-soft-alternance.strategy';
import { SingleBurstStrategy } from './strategies/single-burst.strategy';
import { CleanOnsetStrategy } from './strategies/clean-onset.strategy';
import { ControlledVibratoStrategy } from './strategies/controlled-vibrato-exercise.strategy';
import { StepExpansionStrategy } from './strategies/step-expansion.strategy';
import { MixCoordinationStrategy } from './strategies/mix-coordination.strategy';
import {
  ExerciseDescriptor,
  ExerciseDefinition,
  ExerciseFrameEvaluation,
  ExerciseKind,
  ExerciseRuntimeState,
  ExerciseResult,
  VoiceFrame,
} from './exercise-engine.models';
import { ExerciseStrategy } from './exercise-engine.strategy';

@Injectable({ providedIn: 'root' })
export class ExerciseEngineService {
  private voiceDetection = inject(VoiceDetectionService);
  private pitchService = inject(AudioPitchService);
  private strategies: Record<ExerciseKind, ExerciseStrategy>;

  constructor() {
    const pitchTargetStrategy = new PitchTargetStrategy(this.voiceDetection, this.pitchService);
    const steadyToneStrategy = new SteadyToneStrategy(this.voiceDetection);
    const pitchStepsStrategy = new PitchStepsStrategy(this.voiceDetection, this.pitchService);
    const pitchGlideStrategy = new PitchGlideStrategy(this.voiceDetection, this.pitchService);
    const breathFlowHoldStrategy = new BreathFlowHoldStrategy(this.voiceDetection, this.pitchService);
    const szBalanceStrategy = new SZBalanceStrategy(this.voiceDetection);
    const dynamicWaveStrategy = new DynamicWaveStrategy(this.voiceDetection);
    const volumeRiseStrategy = new VolumeRiseStrategy(this.voiceDetection);
    const loudSoftAlternanceStrategy = new LoudSoftAlternanceStrategy(this.voiceDetection);
    const singleBurstStrategy = new SingleBurstStrategy(this.voiceDetection, this.pitchService);
    const cleanOnsetStrategy = new CleanOnsetStrategy(this.voiceDetection, this.pitchService);
    const controlledVibratoStrategy = new ControlledVibratoStrategy(this.voiceDetection);
    const stepExpansionStrategy = new StepExpansionStrategy(this.voiceDetection, this.pitchService);
    const mixCoordinationStrategy = new MixCoordinationStrategy(this.voiceDetection, this.pitchService);

    this.strategies = {
      'pitch-target': pitchTargetStrategy,
      'steady-tone': steadyToneStrategy,
      'pitch-steps': pitchStepsStrategy,
      'step-expansion': stepExpansionStrategy,
      'pitch-glide': pitchGlideStrategy,
      'mix-coordination': mixCoordinationStrategy,
      'breath-flow-hold': breathFlowHoldStrategy,
      's-z-balance': szBalanceStrategy,
      'dynamic-wave': dynamicWaveStrategy,
      'volume-rise': volumeRiseStrategy,
      'loud-soft-alternance': loudSoftAlternanceStrategy,
      'single-burst': singleBurstStrategy,
      'clean-onset': cleanOnsetStrategy,
      'controlled-vibrato': controlledVibratoStrategy,
    };
  }

  createRuntimeState(): ExerciseRuntimeState {
    return {
      anchorFrequencyHz: null,
      anchorFrameCount: 0,
      pitchTargetCurrentHoldMs: 0,
      pitchTargetRepetitions: 0,
      pitchTargetLastValidMs: null,
      pitchStepsCurrentHoldMs: 0,
      pitchStepsRepetitions: 0,
      pitchStepsLastValidMs: null,
      currentStepIndex: 0,
      stepValidFrames: [0, 0],
      previousMidi: null,
      glidePhase: 'up',
      pitchGlideRepetitions: 0,
      glidePeakReached: false,
      glideReturnedStart: false,
      rmsAnchorDb: null,
      rmsAnchorFrameCount: 0,
      szPhase: 's',
      szSamplesZ: 0,
      szSPhaseDurationMs: 0,
      szZPhaseDurationMs: 0,
      szZRequiredDurationMs: 0,
      szZStartMs: null,
      szZMaxDurationMs: 0,
      szLastValidFrameMs: null,
      dynamicPhase: 'rise',
      dynamicAnchorDb: null,
      dynamicAnchorFrameCount: 0,
      dynamicPeakDb: null,
      dynamicPeakReached: false,
      dynamicReturned: false,
      dynamicCyclesCompleted: 0,
      volumeRiseAnchorDb: null,
      volumeRiseAnchorFrameCount: 0,
      volumeRiseAnchorFrequencyHz: null,
      volumeRisePitchFrameCount: 0,
      volumeRisePeakDb: null,
      volumeRisePeakReached: false,
      alternancePhase: 'loud',
      alternanceCyclesCompleted: 0,
      alternanceAnchorDb: null,
      alternanceAnchorFrameCount: 0,
      alternanceAnchorFrequencyHz: null,
      alternancePitchFrameCount: 0,
      alternancePeakDb: null,
      singleBurstAnchorDb: null,
      singleBurstAnchorFrameCount: 0,
      singleBurstAttackReached: false,
      onsetStartTimeMs: null,
      onsetLatencyMs: null,
      onsetReachedTarget: false,
      vibratoAnchorFrequencyHz: null,
      vibratoAnchorFrameCount: 0,
      vibratoLastSign: 0,
      vibratoDirectionChanges: 0,
      vibratoMaxCents: null,
      vibratoMinCents: null,
      mixTransitionSamples: 0,
      mixTransitionReached: false,
      breathHoldCurrentStartMs: null,
      breathHoldMaxMs: 0,
    };
  }

  createDefinitionFromExercise(exercise: ExerciseDescriptor): ExerciseDefinition {
    const kind = resolveExerciseKindFromName(exercise.exerciseName);
    if (!kind) {
      throw new Error(`Tipo de ejercicio aún no implementado: ${exercise.exerciseName}`);
    }

    return this.strategies[kind].buildDefinition(exercise);
  }

  getPrimaryCheckLabel(definition: ExerciseDefinition): string {
    if (definition.kind === 'pitch-target') {
      return 'Nota objetivo';
    }
    if (definition.kind === 'steady-tone') {
      return `Estabilidad tonal (±${definition.rules.toleranceCents} cents)`;
    }
    if (definition.kind === 'pitch-steps') {
      return `Paso tonal correcto (±${definition.rules.toleranceCents} cents)`;
    }
    if (definition.kind === 'step-expansion') {
      return `Secuencia tonal correcta (±${definition.rules.toleranceCents} cents)`;
    }
    if (definition.kind === 'pitch-glide') {
      return `Deslizamiento continuo (${definition.rules.glideSpanSemitones} semitonos)`;
    }
    if (definition.kind === 'mix-coordination') {
      return 'Transición de registro coordinada';
    }
    if (definition.kind === 'breath-flow-hold') {
      return `Nota y potencia estables (±${definition.rules.pitchToleranceCents} cents, ±${definition.rules.rmsStabilityToleranceDb} dB)`;
    }
    if (definition.kind === 's-z-balance') {
      return `Mantén la nota objetivo (±${definition.rules.toleranceSemitones} semitonos)`;
    }
    if (definition.kind === 'dynamic-wave') {
      return 'Nota objetivo';
    }
    if (definition.kind === 'volume-rise') {
      return 'Incremento progresivo de volumen';
    }
    if (definition.kind === 'loud-soft-alternance') {
      return 'Cambio dinámico fuerte↔suave';
    }
    if (definition.kind === 'single-burst') {
      return 'Ataque energético controlado';
    }
    if (definition.kind === 'clean-onset') {
      return 'Inicio limpio en tono objetivo';
    }
    if (definition.kind === 'controlled-vibrato') {
      return 'Vibrato regular y controlado';
    }
    return 'Afinación correcta';
  }

  shouldShowTargetReference(definition: ExerciseDefinition): boolean {
    return definition.kind === 'pitch-target' || definition.kind === 'pitch-steps' || definition.kind === 'step-expansion' || definition.kind === 'pitch-glide' || definition.kind === 'mix-coordination' || definition.kind === 'single-burst' || definition.kind === 'clean-onset' || definition.kind === 'breath-flow-hold' || definition.kind === 'dynamic-wave';
  }

  getPracticePrompt(definition: ExerciseDefinition, targetNote?: string, runtime?: ExerciseRuntimeState): string {
    if (definition.kind === 'pitch-target') {
      const reps = runtime?.pitchTargetRepetitions ?? 0;
      return `Mantén ${targetNote ?? 'la nota objetivo'} por 3s (${Math.min(3, reps)}/3)`;
    }
    if (definition.kind === 'steady-tone') {
      return 'Sostén una nota cómoda y mantenla estable';
    }
    if (definition.kind === 'breath-flow-hold') {
      return `Sostén ${targetNote ?? 'la nota objetivo'} con volumen parejo y flujo constante`;
    }
    if (definition.kind === 's-z-balance') {
      const phase = runtime?.szPhase ?? 's';
      if (phase === 's') return 'Fase S: cronometra tu "S" hasta donde puedas';
      if (phase === 'z') {
        const sSec = runtime ? Math.max(0, runtime.szZRequiredDurationMs / 1000) : 0;
        return `Fase nota: mantén la nota objetivo durante ${sSec.toFixed(1)}s`;
      }
      return '¡Ejercicio S-Z completado!';
    }
    if (definition.kind === 'dynamic-wave') {
      const phase = runtime?.dynamicPhase ?? 'rise';
      const cycles = runtime?.dynamicCyclesCompleted ?? 0;
      if (phase === 'rise') return `Repetición ${Math.min(definition.rules.requiredCycles, cycles + 1)}/${definition.rules.requiredCycles}: empieza suave y sube el volumen sin cambiar la nota`;
      if (phase === 'fall') return `Repetición ${Math.min(definition.rules.requiredCycles, cycles + 1)}/${definition.rules.requiredCycles}: ahora baja al volumen inicial manteniendo la nota`;
      return `¡Patrón completado! ${Math.min(definition.rules.requiredCycles, cycles)}/${definition.rules.requiredCycles}`;
    }
    if (definition.kind === 'volume-rise') {
      return 'Mantén el tono y sube gradualmente el volumen';
    }
    if (definition.kind === 'loud-soft-alternance') {
      const phase = runtime?.alternancePhase ?? 'loud';
      if (phase === 'loud') return 'Fase fuerte: aumenta energía sin perder el tono';
      if (phase === 'soft') return 'Fase suave: vuelve al volumen inicial';
      return '¡Alternancia completada!';
    }
    if (definition.kind === 'single-burst') {
      return 'Emite un ataque firme y sostenlo con tono estable';
    }
    if (definition.kind === 'clean-onset') {
      return 'Inicia la nota directamente en el tono objetivo';
    }
    if (definition.kind === 'controlled-vibrato') {
      return 'Sostén una nota y genera oscilaciones regulares de vibrato';
    }
    if (definition.kind === 'mix-coordination') {
      const phase = runtime?.glidePhase ?? 'up';
      return phase === 'down'
        ? `Regresa suavemente al punto inicial (${targetNote ?? 'nota base'})`
        : `Cruza la zona mixta hacia ${targetNote ?? 'la nota alta'}`;
    }
    if (definition.kind === 'pitch-steps') {
      const step = (runtime?.currentStepIndex ?? 0) + 1;
      const reps = runtime?.pitchStepsRepetitions ?? 0;
      return `Repetición ${Math.min(3, reps + 1)}/3 · Nota ${Math.min(2, step)}/2: canta ${targetNote ?? 'la nota objetivo'} por 1s`;
    }
    if (definition.kind === 'step-expansion') {
      const total = definition.rules.sequenceMidis.length;
      const step = Math.min(total, (runtime?.currentStepIndex ?? 0) + 1);
      return `Secuencia ${step}/${total}: canta ${targetNote ?? 'la nota objetivo'}`;
    }
    if (definition.kind === 'pitch-glide') {
      const phase = runtime?.glidePhase ?? 'up';
      const repetitions = runtime?.pitchGlideRepetitions ?? 0;
      const total = definition.rules.requiredRepetitions;
      const nextRep = Math.min(total, repetitions + 1);
      const repLabel = `Repetición ${nextRep}/${total}`;
      return phase === 'down'
        ? `${repLabel}: regresa hacia ${targetNote ?? 'la nota base'}`
        : `${repLabel}: desliza suavemente hacia ${targetNote ?? 'la nota alta'}`;
    }
    return `Sosteniendo nota ${targetNote ?? ''}...`;
  }

  getTargetReferenceLabel(definition: ExerciseDefinition, runtime: ExerciseRuntimeState): string | null {
    if (definition.kind === 'steady-tone' || definition.kind === 'volume-rise' || definition.kind === 'loud-soft-alternance') return null;

    if (definition.kind === 'dynamic-wave') {
      return this.pitchService.midiToNoteName(definition.rules.targetMidi);
    }

    if (definition.kind === 's-z-balance') {
      return this.pitchService.midiToNoteName(definition.rules.targetMidi);
    }

    if (definition.kind === 'breath-flow-hold') {
      return this.pitchService.midiToNoteName(definition.rules.targetMidi);
    }

    if (definition.kind === 'pitch-target') {
      return this.pitchService.midiToNoteName(definition.rules.targetMidi);
    }

    if (definition.kind === 'single-burst') {
      return this.pitchService.midiToNoteName(definition.rules.targetMidi);
    }

    if (definition.kind === 'clean-onset') {
      return this.pitchService.midiToNoteName(definition.rules.targetMidi);
    }

    if (definition.kind === 'pitch-steps') {
      const midi = runtime.currentStepIndex === 0 ? definition.rules.startMidi : definition.rules.endMidi;
      return this.pitchService.midiToNoteName(midi);
    }

    if (definition.kind === 'step-expansion') {
      const index = Math.min(runtime.currentStepIndex, definition.rules.sequenceMidis.length - 1);
      return this.pitchService.midiToNoteName(definition.rules.sequenceMidis[index]);
    }

    if (definition.kind === 'pitch-glide') {
      const start = this.pitchService.midiToNoteName(definition.rules.startMidi);
      const end = this.pitchService.midiToNoteName(definition.rules.endMidi);
      return `${start} → ${end} → ${start}`;
    }

    if (definition.kind === 'mix-coordination') {
      const start = this.pitchService.midiToNoteName(definition.rules.startMidi);
      const mix = this.pitchService.midiToNoteName(definition.rules.mixCenterMidi);
      const end = this.pitchService.midiToNoteName(definition.rules.endMidi);
      return `${start} → ${mix} → ${end} → ${start}`;
    }

    return null;
  }

  getCurrentTargetMidi(definition: ExerciseDefinition, runtime: ExerciseRuntimeState): number | null {
    if (definition.kind === 'pitch-target') return definition.rules.targetMidi;
    if (definition.kind === 'single-burst') return definition.rules.targetMidi;
    if (definition.kind === 'clean-onset') return definition.rules.targetMidi;
    if (definition.kind === 'breath-flow-hold') return definition.rules.targetMidi;
    if (definition.kind === 's-z-balance') return definition.rules.targetMidi;
    if (definition.kind === 'dynamic-wave') return definition.rules.targetMidi;
    if (definition.kind === 'pitch-steps') {
      return runtime.currentStepIndex === 0 ? definition.rules.startMidi : definition.rules.endMidi;
    }
    if (definition.kind === 'step-expansion') {
      const index = Math.min(runtime.currentStepIndex, definition.rules.sequenceMidis.length - 1);
      return definition.rules.sequenceMidis[index];
    }
    if (definition.kind === 'pitch-glide') {
      return runtime.glidePhase === 'down' ? definition.rules.startMidi : definition.rules.endMidi;
    }
    if (definition.kind === 'mix-coordination') {
      return runtime.glidePhase === 'down' ? definition.rules.startMidi : definition.rules.endMidi;
    }
    return null;
  }

  evaluateFrame(
    frame: VoiceFrame,
    definition: ExerciseDefinition,
    runtime: ExerciseRuntimeState
  ): ExerciseFrameEvaluation {
    return this.strategies[definition.kind].evaluateFrame(frame, definition, runtime);
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    return this.strategies[definition.kind].buildResult(validFrames, definition, runtime);
  }
}
