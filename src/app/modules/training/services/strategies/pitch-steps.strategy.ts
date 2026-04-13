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
      minSamplesPerStep: levelConfig.minSamplesPerStep,
      minSamples: levelConfig.minSamplesPerStep * 2,
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
      if (
        runtime.currentStepIndex === 0 &&
        runtime.stepValidFrames[0] >= rules.minSamplesPerStep
      ) {
        runtime.currentStepIndex = 1;
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

  buildResult(validFrames: number, definition: ExerciseDefinition): ExerciseResult {
    const rules = definition.rules as PitchStepsRules;
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
