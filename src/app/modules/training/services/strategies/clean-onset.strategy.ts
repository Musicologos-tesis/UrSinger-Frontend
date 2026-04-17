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

    if (voiceDetected && runtime.onsetStartTimeMs === null) {
      runtime.onsetStartTimeMs = frame.timestamp;
    }

    const centsFromTarget =
      frame.frequency > 0 && rules.targetFrequencyHz > 0
        ? 1200 * Math.log2(frame.frequency / rules.targetFrequencyHz)
        : Number.POSITIVE_INFINITY;

    const inTuneOk = Number.isFinite(centsFromTarget) && Math.abs(centsFromTarget) <= rules.toleranceCents;

    if (
      voiceDetected &&
      edgeConfidenceOk &&
      inTuneOk &&
      runtime.onsetStartTimeMs !== null &&
      runtime.onsetLatencyMs === null
    ) {
      runtime.onsetLatencyMs = frame.timestamp - runtime.onsetStartTimeMs;
      runtime.onsetReachedTarget = runtime.onsetLatencyMs <= rules.maxOnsetLatencyMs;
    }

    const latencyOk = runtime.onsetLatencyMs !== null && runtime.onsetLatencyMs <= rules.maxOnsetLatencyMs;
    const primaryOk = inTuneOk && latencyOk;

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
    const rules = definition.rules as CleanOnsetRules;
    const requiredFrames = rules.minSamples;
    const completionRatio = requiredFrames > 0 ? Math.min(1, validFrames / requiredFrames) : 0;
    const onsetOk =
      runtime?.onsetReachedTarget === true &&
      runtime?.onsetLatencyMs !== null &&
      runtime.onsetLatencyMs <= rules.maxOnsetLatencyMs;

    return {
      passed: validFrames >= requiredFrames && onsetOk,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
