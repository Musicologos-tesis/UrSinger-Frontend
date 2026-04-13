import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  SteadyToneRules,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class SteadyToneStrategy implements ExerciseStrategy {
  readonly kind = 'steady-tone' as const;

  constructor(private readonly voiceDetection: VoiceDetectionService) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['steady-tone'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: SteadyToneRules = {
      toleranceCents: levelConfig.toleranceCents,
      minSamples: levelConfig.minSamples,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
      anchorFrames: levelConfig.anchorFrames,
    };

    return {
      id: exercise.id,
      kind: 'steady-tone',
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
    const rules = definition.rules as SteadyToneRules;

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

    if (voiceDetected && edgeConfidenceOk && frame.frequency > 0) {
      if (runtime.anchorFrequencyHz === null) {
        runtime.anchorFrequencyHz = frame.frequency;
        runtime.anchorFrameCount = 1;
      } else if (runtime.anchorFrameCount < rules.anchorFrames) {
        const n = runtime.anchorFrameCount;
        runtime.anchorFrequencyHz = (runtime.anchorFrequencyHz * n + frame.frequency) / (n + 1);
        runtime.anchorFrameCount = n + 1;
      }
    }

    const anchorFrequency = runtime.anchorFrequencyHz;
    const centsFromAnchor =
      anchorFrequency && frame.frequency > 0
        ? 1200 * Math.log2(frame.frequency / anchorFrequency)
        : Number.POSITIVE_INFINITY;

    const primaryOk =
      runtime.anchorFrameCount >= rules.anchorFrames &&
      Number.isFinite(centsFromAnchor) &&
      Math.abs(centsFromAnchor) <= rules.toleranceCents;

    return {
      checks: {
        voiceDetected,
        edgeConfidenceOk,
        primaryOk,
      },
      isValidFrame: voiceDetected && edgeConfidenceOk && primaryOk,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition): ExerciseResult {
    const rules = definition.rules as SteadyToneRules;
    const requiredFrames = rules.minSamples;
    const completionRatio = requiredFrames > 0 ? Math.min(1, validFrames / requiredFrames) : 0;

    return {
      passed: validFrames >= requiredFrames,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
