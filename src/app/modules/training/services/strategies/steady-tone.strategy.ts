import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
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
  private readonly MAX_BRIEF_DROP_MS = 220;

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['steady-tone'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: SteadyToneRules = {
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

    const centsFromAnchor =
      frame.frequency > 0 && rules.targetFrequencyHz > 0
        ? 1200 * Math.log2(frame.frequency / rules.targetFrequencyHz)
        : Number.POSITIVE_INFINITY;

    const primaryOk = Number.isFinite(centsFromAnchor) && Math.abs(centsFromAnchor) <= rules.toleranceCents;
    const isValidFrame = voiceDetected && edgeConfidenceOk && primaryOk;

    if (isValidFrame) {
      if (runtime.steadyToneLastValidMs === null) {
        runtime.steadyToneLastValidMs = frame.timestamp;
      } else {
        const deltaMs = Math.max(0, frame.timestamp - runtime.steadyToneLastValidMs);
        runtime.steadyToneCurrentHoldMs += deltaMs;
        runtime.steadyToneLastValidMs = frame.timestamp;
      }

      if (runtime.steadyToneCurrentHoldMs >= rules.holdDurationMs) {
        runtime.steadyToneRepetitions += 1;
        runtime.steadyToneCurrentHoldMs = 0;
        runtime.steadyToneLastValidMs = null;
      }
    } else {
      if (runtime.steadyToneLastValidMs === null) {
        runtime.steadyToneCurrentHoldMs = 0;
      } else {
        const invalidGapMs = Math.max(0, frame.timestamp - runtime.steadyToneLastValidMs);
        if (invalidGapMs > this.MAX_BRIEF_DROP_MS) {
          runtime.steadyToneCurrentHoldMs = 0;
          runtime.steadyToneLastValidMs = null;
        } else {
          runtime.steadyToneLastValidMs = frame.timestamp;
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
    const rules = definition.rules as SteadyToneRules;
    const requiredFrames = rules.minSamples;
    const repetitions = runtime?.steadyToneRepetitions ?? 0;
    const completionRatio = rules.requiredRepetitions > 0
      ? Math.min(1, repetitions / rules.requiredRepetitions)
      : 0;

    return {
      passed: repetitions >= rules.requiredRepetitions,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
