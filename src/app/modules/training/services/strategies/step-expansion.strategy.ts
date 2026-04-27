import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  StepExpansionRules,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class StepExpansionStrategy implements ExerciseStrategy {
  readonly kind = 'step-expansion' as const;

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['step-expansion'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const ascending = this.buildAscendingOffsets(levelConfig.noteCount, levelConfig.semitoneSpan);
    const descending = ascending.slice(0, -1).reverse();
    const sequenceOffsets = [...ascending, ...descending];

    const sequenceMidis = sequenceOffsets.map(offset => exercise.targetMidi + offset);
    const sequenceFrequenciesHz = sequenceMidis.map(midi => this.pitchService.midiToFrequency(midi));

    const rules: StepExpansionRules = {
      sequenceMidis,
      sequenceFrequenciesHz,
      semitoneSpan: levelConfig.semitoneSpan,
      noteCount: levelConfig.noteCount,
      requiredRepetitions: levelConfig.requiredRepetitions,
      toleranceCents: levelConfig.toleranceCents,
      minSamplesPerStep: levelConfig.minSamplesPerStep,
      minSamples: levelConfig.minSamplesPerStep * sequenceMidis.length * levelConfig.requiredRepetitions,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
    };

    return {
      id: exercise.id,
      kind: 'step-expansion',
      level: exercise.level,
      durationSec: levelConfig.durationSec,
      rules,
    };
  }

  evaluateFrame(
    frame: VoiceFrame,
    definition: ExerciseDefinition,
    runtime: ExerciseRuntimeState
  ): ExerciseFrameEvaluation {
    const rules = definition.rules as StepExpansionRules;

    if (runtime.stepValidFrames.length !== rules.sequenceMidis.length) {
      runtime.stepValidFrames = Array(rules.sequenceMidis.length).fill(0);
      runtime.currentStepIndex = 0;
    }

    const voiceDetected = this.voiceDetection.isValidVocalSample(
      {
        frequency: frame.frequency,
        confidence: frame.confidence,
        midiNote: frame.midiNote,
        rms: frame.rms,
      },
      {
        minVoiceRmsDb: rules.minVoiceRmsDb,
        minFrequencyHz: rules.minFrequencyHz,
        maxFrequencyHz: rules.maxFrequencyHz,
      }
    );

    const edgeConfidenceOk =
      frame.frequency < rules.edgeFrequencyLowHz || frame.frequency > rules.edgeFrequencyHighHz
        ? frame.confidence >= rules.minEdgeConfidence
        : true;

    const safeStepIndex = Math.min(runtime.currentStepIndex, rules.sequenceFrequenciesHz.length - 1);
    const targetFrequencyHz = rules.sequenceFrequenciesHz[safeStepIndex];

    const centsFromTarget =
      frame.frequency > 0 && targetFrequencyHz > 0
        ? 1200 * Math.log2(frame.frequency / targetFrequencyHz)
        : Number.POSITIVE_INFINITY;

    const primaryOk = Number.isFinite(centsFromTarget) && Math.abs(centsFromTarget) <= rules.toleranceCents;
    const isValidFrame = voiceDetected && edgeConfidenceOk && primaryOk;

    if (isValidFrame) {
      runtime.stepValidFrames[safeStepIndex] += 1;

      const stepCompleted = runtime.stepValidFrames[safeStepIndex] >= rules.minSamplesPerStep;
      const hasNextStep = safeStepIndex < rules.sequenceMidis.length - 1;
      if (stepCompleted && hasNextStep) {
        runtime.currentStepIndex = safeStepIndex + 1;
      } else if (stepCompleted && !hasNextStep) {
        runtime.stepExpansionRepetitions += 1;

        if (runtime.stepExpansionRepetitions >= rules.requiredRepetitions) {
          runtime.currentStepIndex = safeStepIndex;
        } else {
          runtime.currentStepIndex = 0;
          runtime.stepValidFrames = Array(rules.sequenceMidis.length).fill(0);
        }
      }
    }

    return {
      checks: {
        voiceDetected,
        edgeConfidenceOk,
        primaryOk,
      },
      isValidFrame,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    const rules = definition.rules as StepExpansionRules;
    const repetitions = runtime?.stepExpansionRepetitions ?? 0;
    const requiredFrames = rules.requiredRepetitions;
    const completionRatio = requiredFrames > 0 ? Math.min(1, repetitions / requiredFrames) : 0;

    return {
      passed: repetitions >= rules.requiredRepetitions,
      validFrames: repetitions,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }

  private buildAscendingOffsets(noteCount: number, semitoneSpan: number): number[] {
    if (noteCount <= 1) {
      return [0];
    }

    const offsets: number[] = [];
    for (let i = 0; i < noteCount; i++) {
      const t = i / (noteCount - 1);
      const offset = Math.round(t * semitoneSpan);
      offsets.push(offset);
    }

    offsets[0] = 0;
    offsets[offsets.length - 1] = semitoneSpan;

    for (let i = 1; i < offsets.length; i++) {
      if (offsets[i] < offsets[i - 1]) {
        offsets[i] = offsets[i - 1];
      }
    }

    return offsets;
  }
}
