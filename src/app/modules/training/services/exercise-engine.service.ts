import { Injectable, inject } from '@angular/core';
import { VoiceDetectionService } from '../../../services/voice-detection.service';
import { AudioPitchService } from '../../checkup/services/audio-pitch.service';
import { resolveExerciseKindFromId, resolveExerciseKindFromName } from './exercise-engine.config';
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
    const steadyToneStrategy = new SteadyToneStrategy(this.voiceDetection, this.pitchService);
    const pitchStepsStrategy = new PitchStepsStrategy(this.voiceDetection, this.pitchService);
    const pitchGlideStrategy = new PitchGlideStrategy(this.voiceDetection, this.pitchService);
    const breathFlowHoldStrategy = new BreathFlowHoldStrategy(this.voiceDetection, this.pitchService);
    const szBalanceStrategy = new SZBalanceStrategy(this.voiceDetection);
    const dynamicWaveStrategy = new DynamicWaveStrategy(this.voiceDetection);
    const volumeRiseStrategy = new VolumeRiseStrategy(this.voiceDetection, this.pitchService);
    const loudSoftAlternanceStrategy = new LoudSoftAlternanceStrategy(this.voiceDetection, this.pitchService);
    const singleBurstStrategy = new SingleBurstStrategy(this.voiceDetection, this.pitchService);
    const cleanOnsetStrategy = new CleanOnsetStrategy(this.voiceDetection, this.pitchService);
    const controlledVibratoStrategy = new ControlledVibratoStrategy(this.voiceDetection, this.pitchService);
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
      steadyToneCurrentHoldMs: 0,
      steadyToneRepetitions: 0,
      steadyToneLastValidMs: null,
      pitchTargetCurrentHoldMs: 0,
      pitchTargetRepetitions: 0,
      pitchTargetLastValidMs: null,
      pitchStepsCurrentHoldMs: 0,
      pitchStepsRepetitions: 0,
      pitchStepsLastValidMs: null,
      currentStepIndex: 0,
      stepValidFrames: [0, 0],
        stepExpansionRepetitions: 0,
      previousMidi: null,
      glidePhase: 'up',
      pitchGlideRepetitions: 0,
      mixCoordinationRepetitions: 0,
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
      volumeRiseCurrentHoldMs: 0,
      volumeRiseRepetitions: 0,
      volumeRiseLastValidMs: null,
      volumeRiseAwaitingRelease: false,
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
      singleBurstRepetitions: 0,
      singleBurstAwaitingRelease: false,
      onsetStartTimeMs: null,
      onsetLatencyMs: null,
      onsetReachedTarget: false,
      cleanOnsetRepetitions: 0,
      cleanOnsetAwaitingRelease: false,
      cleanOnsetAttemptResolved: false,
      vibratoAnchorFrequencyHz: null,
      vibratoAnchorFrameCount: 0,
      vibratoLastSign: 0,
      vibratoDirectionChanges: 0,
      vibratoMaxCents: null,
      vibratoMinCents: null,
      controlledVibratoHoldMs: 0,
      controlledVibratoLastValidMs: null,
      controlledVibratoLastTargetMs: null,
      controlledVibratoTargetReturns: 0,
      controlledVibratoWasNearTarget: false,
      mixTransitionSamples: 0,
      mixTransitionReached: false,
      breathHoldCurrentStartMs: null,
      breathHoldMaxMs: 0,
    };
  }

  createDefinitionFromExercise(exercise: ExerciseDescriptor): ExerciseDefinition {
    const kind = resolveExerciseKindFromId(exercise.exerciseId) ?? resolveExerciseKindFromName(exercise.exerciseName);
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
      return `Nota objetivo (±${definition.rules.toleranceCents} cents)`;
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
      return 'Nota sostenida con aumento de potencia';
    }
    if (definition.kind === 'loud-soft-alternance') {
      return `Nota objetivo (±${definition.rules.pitchToleranceCents} cents)`;
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
    return definition.kind === 'pitch-target' || definition.kind === 'steady-tone' || definition.kind === 'pitch-steps' || definition.kind === 'step-expansion' || definition.kind === 'pitch-glide' || definition.kind === 'mix-coordination' || definition.kind === 'single-burst' || definition.kind === 'clean-onset' || definition.kind === 'breath-flow-hold' || definition.kind === 'dynamic-wave' || definition.kind === 'controlled-vibrato' || definition.kind === 'volume-rise' || definition.kind === 'loud-soft-alternance';
  }

  getPracticePrompt(definition: ExerciseDefinition, targetNote?: string, runtime?: ExerciseRuntimeState): string {
    if (definition.kind === 'pitch-target') {
      const reps = runtime?.pitchTargetRepetitions ?? 0;
      return `Mantén ${targetNote ?? 'la nota objetivo'} por 3s (${Math.min(3, reps)}/3)`;
    }
    if (definition.kind === 'volume-rise') {
      const reps = runtime?.volumeRiseRepetitions ?? 0;
      const holdSec = Math.round(definition.rules.holdDurationMs / 1000);
      const total = definition.rules.requiredRepetitions;
      const nextRep = Math.min(total, reps + 1);
      return `Repetición ${nextRep}/${total}: mantén ${targetNote ?? 'la nota objetivo'} por ${holdSec}s y súbele un poco la potencia`;
    }
    if (definition.kind === 'steady-tone') {
      const reps = runtime?.steadyToneRepetitions ?? 0;
      const holdSec = Math.round(definition.rules.holdDurationMs / 1000);
      const total = definition.rules.requiredRepetitions;
      const nextRep = Math.min(total, reps + 1);
      return `Repetición ${nextRep}/${total}: mantén ${targetNote ?? 'la nota objetivo'} por ${holdSec}s`;
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
    if (definition.kind === 'loud-soft-alternance') {
      const phase = runtime?.alternancePhase ?? 'loud';
      const cycles = runtime?.alternanceCyclesCompleted ?? 0;
      const total = definition.rules.requiredCycles;
      if (phase === 'loud') return `Repetición ${Math.min(total, cycles + 1)}/${total}: empieza suave y súbele potencia`;
      if (phase === 'soft') return `Repetición ${Math.min(total, cycles + 1)}/${total}: baja de nuevo a suave sin salirte de la nota`;
      return `¡Alternancia completada! ${Math.min(total, cycles)}/${total}`;
    }
    if (definition.kind === 'single-burst') {
      const reps = runtime?.singleBurstRepetitions ?? 0;
      const total = definition.rules.requiredRepetitions;
      const nextRep = Math.min(total, reps + 1);
      return `Repetición ${nextRep}/${total}: emite un ataque firme y vuelve a iniciar para la siguiente`;
    }
    if (definition.kind === 'clean-onset') {
      const reps = runtime?.cleanOnsetRepetitions ?? 0;
      const total = definition.rules.requiredRepetitions;
      const nextRep = Math.min(total, reps + 1);
      return `Repetición ${nextRep}/${total}: inicia ${targetNote ?? 'la nota objetivo'} sin deslizar desde otra nota`;
    }
    if (definition.kind === 'controlled-vibrato') {
      const holdSec = Math.round(definition.rules.requiredHoldMs / 1000);
      return `Mantén ${targetNote ?? 'la nota objetivo'} y aplica vibrato controlado por ${holdSec}s`;
    }
    if (definition.kind === 'mix-coordination') {
      const phase = runtime?.glidePhase ?? 'up';
      const repetitions = runtime?.mixCoordinationRepetitions ?? 0;
      const total = definition.rules.requiredRepetitions;
      const nextRep = Math.min(total, repetitions + 1);
      return phase === 'down'
        ? `Repetición ${nextRep}/${total}: regresa a la nota grave con cambio limpio de registro`
        : `Repetición ${nextRep}/${total}: sube hacia la nota aguda para coordinar pecho -> cabeza`;
    }
    if (definition.kind === 'pitch-steps') {
      const step = (runtime?.currentStepIndex ?? 0) + 1;
      const reps = runtime?.pitchStepsRepetitions ?? 0;
      return `Repetición ${Math.min(3, reps + 1)}/3 · Nota ${Math.min(2, step)}/2: canta ${targetNote ?? 'la nota objetivo'} por 1s`;
    }
    if (definition.kind === 'step-expansion') {
      const totalSteps = definition.rules.sequenceMidis.length;
      const step = Math.min(totalSteps, (runtime?.currentStepIndex ?? 0) + 1);
      const repetitions = runtime?.stepExpansionRepetitions ?? 0;
      const totalRepetitions = definition.rules.requiredRepetitions;
      const nextRep = Math.min(totalRepetitions, repetitions + 1);
      return `Repetición ${nextRep}/${totalRepetitions} · Nota ${step}/${totalSteps}: canta ${targetNote ?? 'la nota objetivo'}`;
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
    if (definition.kind === 'loud-soft-alternance') {
      return this.pitchService.midiToNoteName(definition.rules.targetMidi);
    }

    if (definition.kind === 'steady-tone') {
      return this.pitchService.midiToNoteName(definition.rules.targetMidi);
    }

    if (definition.kind === 'volume-rise') {
      return this.pitchService.midiToNoteName(definition.rules.targetMidi);
    }

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

    if (definition.kind === 'controlled-vibrato') {
      return this.pitchService.midiToNoteName(definition.rules.targetMidi);
    }

    if (definition.kind === 'pitch-steps') {
      const midi = runtime.currentStepIndex === 0 ? definition.rules.startMidi : definition.rules.endMidi;
      return this.pitchService.midiToNoteName(midi);
    }

    if (definition.kind === 'step-expansion') {
      const sequence = definition.rules.sequenceMidis.map((midi) => this.pitchService.midiToNoteName(midi));
      return sequence.join(' -> ');
    }

    if (definition.kind === 'pitch-glide') {
      const start = this.pitchService.midiToNoteName(definition.rules.startMidi);
      const end = this.pitchService.midiToNoteName(definition.rules.endMidi);
      return `${start} → ${end} → ${start}`;
    }

    if (definition.kind === 'mix-coordination') {
      const start = this.pitchService.midiToNoteName(definition.rules.startMidi);
      const end = this.pitchService.midiToNoteName(definition.rules.endMidi);
      return `${start} → ${end} → ${start}`;
    }

    return null;
  }

  getCurrentTargetMidi(definition: ExerciseDefinition, runtime: ExerciseRuntimeState): number | null {
    if (definition.kind === 'loud-soft-alternance') return definition.rules.targetMidi;
    if (definition.kind === 'steady-tone') return definition.rules.targetMidi;
    if (definition.kind === 'volume-rise') return definition.rules.targetMidi;
    if (definition.kind === 'pitch-target') return definition.rules.targetMidi;
    if (definition.kind === 'single-burst') return definition.rules.targetMidi;
    if (definition.kind === 'clean-onset') return definition.rules.targetMidi;
    if (definition.kind === 'breath-flow-hold') return definition.rules.targetMidi;
    if (definition.kind === 's-z-balance') return definition.rules.targetMidi;
    if (definition.kind === 'dynamic-wave') return definition.rules.targetMidi;
    if (definition.kind === 'controlled-vibrato') return definition.rules.targetMidi;
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
