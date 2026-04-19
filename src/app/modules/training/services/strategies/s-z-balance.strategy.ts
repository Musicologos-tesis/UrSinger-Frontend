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
      minSamples: levelConfig.minSamples,
      minAirRmsDb: levelConfig.minAirRmsDb,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
      maxSPhaseConfidence: levelConfig.maxSPhaseConfidence,
      minSPhaseDurationMs: levelConfig.minSPhaseDurationMs,
      phaseSilenceMs: levelConfig.phaseSilenceMs,
      maxDurationDiffMs: levelConfig.maxDurationDiffMs,
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
      const sPhaseUnvoicedOk = frame.midiNote <= 0 || frame.confidence <= rules.maxSPhaseConfidence;
      const primaryOk = isAirFlowPresent && sPhaseUnvoicedOk;
      const isValidFrame = primaryOk;

      if (isValidFrame) {
        if (runtime.szSPhaseStartMs === null) {
          runtime.szSPhaseStartMs = frame.timestamp;
        }
        runtime.szSPhaseLastAirMs = frame.timestamp;
        runtime.szSPhaseDurationMs = Math.max(0, frame.timestamp - runtime.szSPhaseStartMs);
        runtime.szSamplesS++;
      } else if (
        runtime.szSPhaseStartMs !== null &&
        runtime.szSPhaseLastAirMs !== null &&
        frame.timestamp - runtime.szSPhaseLastAirMs >= rules.phaseSilenceMs &&
        runtime.szSPhaseDurationMs >= rules.minSPhaseDurationMs
      ) {
        runtime.szPhase = 'z';
        runtime.szZPhaseStartMs = null;
        runtime.szZPhaseDurationMs = 0;
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
        if (runtime.szZPhaseStartMs === null) {
          runtime.szZPhaseStartMs = frame.timestamp;
        }
        runtime.szZPhaseDurationMs = Math.max(0, frame.timestamp - runtime.szZPhaseStartMs);
        runtime.szDurationDiffMs = Math.abs(runtime.szZPhaseDurationMs - runtime.szSPhaseDurationMs);
        runtime.szSamplesZ++;

        const hasReachedComparableDuration = runtime.szZPhaseDurationMs >= runtime.szSPhaseDurationMs;
        const diffOk = (runtime.szDurationDiffMs ?? Number.POSITIVE_INFINITY) <= rules.maxDurationDiffMs;
        if (hasReachedComparableDuration && diffOk) {
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
    const sDuration = runtime?.szSPhaseDurationMs ?? 0;
    const zDuration = runtime?.szZPhaseDurationMs ?? 0;
    const diffMs = Math.abs(zDuration - sDuration);
    const phasesCompleted = sDuration >= rules.minSPhaseDurationMs && zDuration > 0;
    const durationMatchOk = diffMs <= rules.maxDurationDiffMs;

    return {
      passed: validFrames >= requiredFrames && phasesCompleted && durationMatchOk,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
