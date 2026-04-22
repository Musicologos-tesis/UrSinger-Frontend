import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  PitchStepsRules,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class PitchStepsStrategy implements ExerciseStrategy {
  readonly kind = 'pitch-steps' as const;
  private readonly MAX_BRIEF_DROP_MS = 220;

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['pitch-steps'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();
    const endMidi = exercise.targetMidi + levelConfig.intervalSemitones;

    const rules: PitchStepsRules = {
      startMidi: exercise.targetMidi,
      endMidi,
      startFrequencyHz: this.pitchService.midiToFrequency(exercise.targetMidi),
      endFrequencyHz: this.pitchService.midiToFrequency(endMidi),
      intervalSemitones: levelConfig.intervalSemitones,
      toleranceCents: levelConfig.toleranceCents,
      noteHoldMs: levelConfig.noteHoldSec * 1000,
      requiredRepetitions: levelConfig.requiredRepetitions,
      minSamplesPerStep: levelConfig.minSamplesPerStep,
      minSamples: levelConfig.minSamplesPerStep * 2 * levelConfig.requiredRepetitions,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
    };

    return {
      id: exercise.id,
      kind: 'pitch-steps',
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
    const rules = definition.rules as PitchStepsRules;

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

    const targetFrequencyHz = runtime.currentStepIndex === 0 ? rules.startFrequencyHz : rules.endFrequencyHz;
    const centsFromTarget =
      frame.frequency > 0 && targetFrequencyHz > 0
        ? 1200 * Math.log2(frame.frequency / targetFrequencyHz)
        : Number.POSITIVE_INFINITY;

    const primaryOk = Number.isFinite(centsFromTarget) && Math.abs(centsFromTarget) <= rules.toleranceCents;
    const isValidFrame = voiceDetected && edgeConfidenceOk && primaryOk;

    if (isValidFrame && runtime.currentStepIndex <= 1) {
      runtime.stepValidFrames[runtime.currentStepIndex]++;

      if (runtime.pitchStepsLastValidMs === null) {
        runtime.pitchStepsLastValidMs = frame.timestamp;
      } else {
        const deltaMs = Math.max(0, frame.timestamp - runtime.pitchStepsLastValidMs);
        runtime.pitchStepsCurrentHoldMs += deltaMs;
        runtime.pitchStepsLastValidMs = frame.timestamp;
      }

      if (runtime.pitchStepsCurrentHoldMs >= rules.noteHoldMs) {
        if (runtime.currentStepIndex === 0) {
          runtime.currentStepIndex = 1;
        } else {
          runtime.pitchStepsRepetitions += 1;
          runtime.currentStepIndex = 0;
        }

        runtime.pitchStepsCurrentHoldMs = 0;
        runtime.pitchStepsLastValidMs = null;
      }
    } else {
      if (runtime.pitchStepsLastValidMs === null) {
        runtime.pitchStepsCurrentHoldMs = 0;
      } else {
        const invalidGapMs = Math.max(0, frame.timestamp - runtime.pitchStepsLastValidMs);
        if (invalidGapMs > this.MAX_BRIEF_DROP_MS) {
          runtime.pitchStepsCurrentHoldMs = 0;
          runtime.pitchStepsLastValidMs = null;
        } else {
          runtime.pitchStepsLastValidMs = frame.timestamp;
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
    const rules = definition.rules as PitchStepsRules;
    const requiredFrames = rules.minSamples;
    const repetitions = runtime?.pitchStepsRepetitions ?? 0;
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
