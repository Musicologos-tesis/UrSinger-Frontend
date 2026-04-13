import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  SZBalanceRules,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class SZBalanceStrategy implements ExerciseStrategy {
  readonly kind = 's-z-balance' as const;

  constructor(private readonly voiceDetection: VoiceDetectionService) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['s-z-balance'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: SZBalanceRules = {
      minSamples: levelConfig.minSamplesPerPhase * 2,
      minSamplesPerPhase: levelConfig.minSamplesPerPhase,
      minAirRmsDb: levelConfig.minAirRmsDb,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
      maxSPhaseConfidence: levelConfig.maxSPhaseConfidence,
    };

    return {
      id: exercise.id,
      kind: 's-z-balance',
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
    const rules = definition.rules as SZBalanceRules;

    const isAirFlowPresent = frame.rms > rules.minAirRmsDb;

    const isVocalSignal = this.voiceDetection.isValidVocalSample(
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

    if (runtime.szPhase === 's') {
      const sPhaseUnvoicedOk = (frame.midiNote <= 0 || frame.confidence <= rules.maxSPhaseConfidence);
      const primaryOk = isAirFlowPresent && sPhaseUnvoicedOk;
      const isValidFrame = primaryOk;

      if (isValidFrame) {
        runtime.szSamplesS++;
        if (runtime.szSamplesS >= rules.minSamplesPerPhase) {
          runtime.szPhase = 'z';
        }
      }

      return {
        checks: {
          voiceDetected: isAirFlowPresent,
          edgeConfidenceOk: true,
          primaryOk,
        },
        isValidFrame,
      };
    }

    if (runtime.szPhase === 'z') {
      const primaryOk = isVocalSignal && edgeConfidenceOk;
      const isValidFrame = primaryOk;

      if (isValidFrame) {
        runtime.szSamplesZ++;
        if (runtime.szSamplesZ >= rules.minSamplesPerPhase) {
          runtime.szPhase = 'complete';
        }
      }

      return {
        checks: {
          voiceDetected: isVocalSignal,
          edgeConfidenceOk,
          primaryOk,
        },
        isValidFrame,
      };
    }

    return {
      checks: {
        voiceDetected: true,
        edgeConfidenceOk: true,
        primaryOk: true,
      },
      isValidFrame: true,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    const rules = definition.rules as SZBalanceRules;
    const requiredFrames = rules.minSamples;
    const completionRatio = requiredFrames > 0 ? Math.min(1, validFrames / requiredFrames) : 0;
    const phasesCompleted = (runtime?.szSamplesS ?? 0) >= rules.minSamplesPerPhase && (runtime?.szSamplesZ ?? 0) >= rules.minSamplesPerPhase;

    return {
      passed: validFrames >= requiredFrames && phasesCompleted,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
