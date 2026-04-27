import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  CleanOnsetRules,
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class CleanOnsetStrategy implements ExerciseStrategy {
  readonly kind = 'clean-onset' as const;

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['clean-onset'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: CleanOnsetRules = {
      targetMidi: exercise.targetMidi,
      targetFrequencyHz: this.pitchService.midiToFrequency(exercise.targetMidi),
      toleranceCents: levelConfig.toleranceCents,
      requiredRepetitions: levelConfig.requiredRepetitions,
      minSamples: levelConfig.minSamples,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
      maxOnsetLatencyMs: levelConfig.maxOnsetLatencyMs,
    };

    return {
      id: exercise.id,
      kind: 'clean-onset',
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
    const rules = definition.rules as CleanOnsetRules;

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

    if (!voiceDetected) {
      this.resetAttemptCycle(runtime);
      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    // Each repetition requires a fresh onset after voice release.
    if (runtime.cleanOnsetAwaitingRelease) {
      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    if (!edgeConfidenceOk || frame.frequency <= 0) {
      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    if (runtime.onsetStartTimeMs === null) {
      runtime.onsetStartTimeMs = frame.timestamp;
      runtime.cleanOnsetAttemptResolved = false;
    }

    const centsFromTarget =
      frame.frequency > 0 && rules.targetFrequencyHz > 0
        ? 1200 * Math.log2(frame.frequency / rules.targetFrequencyHz)
        : Number.POSITIVE_INFINITY;

    const inTuneOk = Number.isFinite(centsFromTarget) && Math.abs(centsFromTarget) <= rules.toleranceCents;
    const onsetLatencyMs = runtime.onsetStartTimeMs !== null ? Math.max(0, frame.timestamp - runtime.onsetStartTimeMs) : 0;
    const latencyOk = onsetLatencyMs <= rules.maxOnsetLatencyMs;
    const onsetSuccess = inTuneOk && latencyOk;

    runtime.onsetLatencyMs = onsetLatencyMs;
    runtime.onsetReachedTarget = onsetSuccess;
    runtime.cleanOnsetAttemptResolved = true;
    runtime.cleanOnsetAwaitingRelease = true;

    if (onsetSuccess) {
      runtime.cleanOnsetRepetitions += 1;
    }

    return {
      checks: {
        voiceDetected,
        edgeConfidenceOk,
        primaryOk: onsetSuccess,
      },
      isValidFrame: onsetSuccess,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    const rules = definition.rules as CleanOnsetRules;
    const repetitions = runtime?.cleanOnsetRepetitions ?? 0;
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

  private resetAttemptCycle(runtime: ExerciseRuntimeState): void {
    runtime.onsetStartTimeMs = null;
    runtime.onsetLatencyMs = null;
    runtime.onsetReachedTarget = false;
    runtime.cleanOnsetAwaitingRelease = false;
    runtime.cleanOnsetAttemptResolved = false;
  }
}
