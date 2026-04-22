import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  PitchTargetRules,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class PitchTargetStrategy implements ExerciseStrategy {
  readonly kind = 'pitch-target' as const;
  private readonly MAX_BRIEF_DROP_MS = 220;

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['pitch-target'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: PitchTargetRules = {
      targetMidi: exercise.targetMidi,
      targetFrequencyHz: this.pitchService.midiToFrequency(exercise.targetMidi),
      toleranceCents: levelConfig.toleranceCents,
      holdDurationMs: levelConfig.holdDurationSec * 1000,
      requiredRepetitions: levelConfig.requiredRepetitions,
      minSamples: levelConfig.minSamples,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
    };

    return {
      id: exercise.id,
      kind: 'pitch-target',
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
    const rules = definition.rules as PitchTargetRules;

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

    const centsFromTarget =
      frame.frequency > 0 && rules.targetFrequencyHz > 0
        ? 1200 * Math.log2(frame.frequency / rules.targetFrequencyHz)
        : Number.POSITIVE_INFINITY;

    const primaryOk = Number.isFinite(centsFromTarget) && Math.abs(centsFromTarget) <= rules.toleranceCents;

    const validFrame = voiceDetected && edgeConfidenceOk && primaryOk;
    if (validFrame) {
      if (runtime.pitchTargetLastValidMs === null) {
        runtime.pitchTargetLastValidMs = frame.timestamp;
      } else {
        const deltaMs = Math.max(0, frame.timestamp - runtime.pitchTargetLastValidMs);
        runtime.pitchTargetCurrentHoldMs += deltaMs;
        runtime.pitchTargetLastValidMs = frame.timestamp;
      }

      if (runtime.pitchTargetCurrentHoldMs >= rules.holdDurationMs) {
        runtime.pitchTargetRepetitions += 1;
        runtime.pitchTargetCurrentHoldMs = 0;
        runtime.pitchTargetLastValidMs = null;
      }
    } else {
      if (runtime.pitchTargetLastValidMs === null) {
        runtime.pitchTargetCurrentHoldMs = 0;
      } else {
        const invalidGapMs = Math.max(0, frame.timestamp - runtime.pitchTargetLastValidMs);
        if (invalidGapMs > this.MAX_BRIEF_DROP_MS) {
          runtime.pitchTargetCurrentHoldMs = 0;
          runtime.pitchTargetLastValidMs = null;
        } else {
          // Mantener la repetición en curso ante micro-cortes de detección
          runtime.pitchTargetLastValidMs = frame.timestamp;
        }
      }
    }

    return {
      checks: {
        voiceDetected,
        edgeConfidenceOk,
        primaryOk,
      },
      isValidFrame: validFrame,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    const rules = definition.rules as PitchTargetRules;
    const requiredFrames = rules.minSamples;
    const completionRatio = requiredFrames > 0 ? Math.min(1, validFrames / requiredFrames) : 0;
    const repetitions = runtime?.pitchTargetRepetitions ?? 0;

    return {
      passed: repetitions >= rules.requiredRepetitions,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
