import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ControlledVibratoRules,
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class ControlledVibratoStrategy implements ExerciseStrategy {
  readonly kind = 'controlled-vibrato' as const;

  constructor(private readonly voiceDetection: VoiceDetectionService) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['controlled-vibrato'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: ControlledVibratoRules = {
      minSamples: levelConfig.minSamples,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
      anchorFrames: levelConfig.anchorFrames,
      minPeakToPeakCents: levelConfig.minPeakToPeakCents,
      maxPeakToPeakCents: levelConfig.maxPeakToPeakCents,
      minDirectionChanges: levelConfig.minDirectionChanges,
      centerDriftToleranceCents: levelConfig.centerDriftToleranceCents,
    };

    return {
      id: exercise.id,
      kind: 'controlled-vibrato',
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
    const rules = definition.rules as ControlledVibratoRules;

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
      if (runtime.vibratoAnchorFrequencyHz === null) {
        runtime.vibratoAnchorFrequencyHz = frame.frequency;
        runtime.vibratoAnchorFrameCount = 1;
      } else if (runtime.vibratoAnchorFrameCount < rules.anchorFrames) {
        const n = runtime.vibratoAnchorFrameCount;
        runtime.vibratoAnchorFrequencyHz = (runtime.vibratoAnchorFrequencyHz * n + frame.frequency) / (n + 1);
        runtime.vibratoAnchorFrameCount = n + 1;
      }
    }

    const anchorReady = runtime.vibratoAnchorFrameCount >= rules.anchorFrames;
    const anchorHz = runtime.vibratoAnchorFrequencyHz;

    if (!voiceDetected || !edgeConfidenceOk || !anchorReady || !anchorHz || frame.frequency <= 0) {
      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    const centsFromAnchor = 1200 * Math.log2(frame.frequency / anchorHz);

    if (runtime.vibratoMaxCents === null || centsFromAnchor > runtime.vibratoMaxCents) {
      runtime.vibratoMaxCents = centsFromAnchor;
    }
    if (runtime.vibratoMinCents === null || centsFromAnchor < runtime.vibratoMinCents) {
      runtime.vibratoMinCents = centsFromAnchor;
    }

    const sign: -1 | 0 | 1 = centsFromAnchor > 0 ? 1 : centsFromAnchor < 0 ? -1 : 0;
    if (sign !== 0 && runtime.vibratoLastSign !== 0 && sign !== runtime.vibratoLastSign) {
      runtime.vibratoDirectionChanges += 1;
    }
    if (sign !== 0) {
      runtime.vibratoLastSign = sign;
    }

    const primaryOk = Math.abs(centsFromAnchor) <= rules.maxPeakToPeakCents / 2;

    return {
      checks: {
        voiceDetected,
        edgeConfidenceOk,
        primaryOk,
      },
      isValidFrame: voiceDetected && edgeConfidenceOk && primaryOk,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    const rules = definition.rules as ControlledVibratoRules;
    const requiredFrames = rules.minSamples;
    const completionRatio = requiredFrames > 0 ? Math.min(1, validFrames / requiredFrames) : 0;

    const max = runtime?.vibratoMaxCents;
    const min = runtime?.vibratoMinCents;
    const peakToPeak = max !== null && max !== undefined && min !== null && min !== undefined ? max - min : 0;
    const center = max !== null && max !== undefined && min !== null && min !== undefined ? (max + min) / 2 : 0;

    const amplitudeOk = peakToPeak >= rules.minPeakToPeakCents && peakToPeak <= rules.maxPeakToPeakCents;
    const regularityOk = (runtime?.vibratoDirectionChanges ?? 0) >= rules.minDirectionChanges;
    const centerOk = Math.abs(center) <= rules.centerDriftToleranceCents;

    return {
      passed: validFrames >= requiredFrames && amplitudeOk && regularityOk && centerOk,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
