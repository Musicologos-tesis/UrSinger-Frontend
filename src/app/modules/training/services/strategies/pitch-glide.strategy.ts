import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  PitchGlideRules,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class PitchGlideStrategy implements ExerciseStrategy {
  readonly kind = 'pitch-glide' as const;

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const isVocalGlide = /vocal\s*glide/i.test(exercise.exerciseName);
    const levelConfig = isVocalGlide
      ? LEVEL_CONFIGS['vocal-glide'][normalized]
      : LEVEL_CONFIGS['pitch-glide'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();
    const endMidi = exercise.targetMidi + levelConfig.glideSpanSemitones;
    const requiredRepetitions = 'requiredRepetitions' in levelConfig ? levelConfig.requiredRepetitions : 1;

    const rules: PitchGlideRules = {
      startMidi: exercise.targetMidi,
      endMidi,
      startFrequencyHz: this.pitchService.midiToFrequency(exercise.targetMidi),
      endFrequencyHz: this.pitchService.midiToFrequency(endMidi),
      glideSpanSemitones: levelConfig.glideSpanSemitones,
      requiredRepetitions,
      endToleranceCents: levelConfig.endToleranceCents,
      minSamples: levelConfig.minSamples * requiredRepetitions,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
    };

    return {
      id: exercise.id,
      kind: 'pitch-glide',
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
    const rules = definition.rules as PitchGlideRules;

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

    if (!(voiceDetected && edgeConfidenceOk) || frame.midiNote <= 0) {
      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    const midi = frame.midiNote;
    const previousMidi = runtime.previousMidi;
    runtime.previousMidi = midi;

    let primaryOk = false;

    if (runtime.glidePhase === 'up') {
      const monotonicOk = previousMidi === null || midi >= previousMidi - 1;
      primaryOk = monotonicOk;

      const centsToHigh = 1200 * Math.log2(frame.frequency / rules.endFrequencyHz);
      if (Number.isFinite(centsToHigh) && Math.abs(centsToHigh) <= rules.endToleranceCents) {
        runtime.glidePeakReached = true;
        runtime.glidePhase = 'down';
      }
    } else if (runtime.glidePhase === 'down') {
      const monotonicOk = previousMidi === null || midi <= previousMidi + 1;
      primaryOk = monotonicOk;

      const centsToStart = 1200 * Math.log2(frame.frequency / rules.startFrequencyHz);
      if (Number.isFinite(centsToStart) && Math.abs(centsToStart) <= rules.endToleranceCents) {
        runtime.glideReturnedStart = true;
        runtime.pitchGlideRepetitions += 1;

        if (runtime.pitchGlideRepetitions >= rules.requiredRepetitions) {
          runtime.glidePhase = 'complete';
        } else {
          runtime.glidePhase = 'up';
          runtime.previousMidi = null;
          runtime.glidePeakReached = false;
          runtime.glideReturnedStart = false;
        }
      }
    } else {
      primaryOk = true;
    }

    return {
      checks: {
        voiceDetected,
        edgeConfidenceOk,
        primaryOk,
      },
      isValidFrame: primaryOk,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    const rules = definition.rules as PitchGlideRules;
    const requiredFrames = rules.minSamples;
    const repetitions = runtime?.pitchGlideRepetitions ?? 0;
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
