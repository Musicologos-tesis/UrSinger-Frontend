import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  VolumeRiseRules,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class VolumeRiseStrategy implements ExerciseStrategy {
  readonly kind = 'volume-rise' as const;

  constructor(private readonly voiceDetection: VoiceDetectionService) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['volume-rise'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: VolumeRiseRules = {
      minSamples: levelConfig.minSamples,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
      rmsAnchorFrames: levelConfig.rmsAnchorFrames,
      pitchAnchorFrames: levelConfig.pitchAnchorFrames,
      pitchToleranceCents: levelConfig.pitchToleranceCents,
      rmsRiseMinDb: levelConfig.rmsRiseMinDb,
    };

    return {
      id: exercise.id,
      kind: 'volume-rise',
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
    const rules = definition.rules as VolumeRiseRules;

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

    if (voiceDetected && edgeConfidenceOk) {
      if (runtime.volumeRiseAnchorDb === null) {
        runtime.volumeRiseAnchorDb = frame.rms;
        runtime.volumeRiseAnchorFrameCount = 1;
      } else if (runtime.volumeRiseAnchorFrameCount < rules.rmsAnchorFrames) {
        const n = runtime.volumeRiseAnchorFrameCount;
        runtime.volumeRiseAnchorDb = (runtime.volumeRiseAnchorDb * n + frame.rms) / (n + 1);
        runtime.volumeRiseAnchorFrameCount = n + 1;
      }

      if (frame.frequency > 0) {
        if (runtime.volumeRiseAnchorFrequencyHz === null) {
          runtime.volumeRiseAnchorFrequencyHz = frame.frequency;
          runtime.volumeRisePitchFrameCount = 1;
        } else if (runtime.volumeRisePitchFrameCount < rules.pitchAnchorFrames) {
          const n = runtime.volumeRisePitchFrameCount;
          runtime.volumeRiseAnchorFrequencyHz = (runtime.volumeRiseAnchorFrequencyHz * n + frame.frequency) / (n + 1);
          runtime.volumeRisePitchFrameCount = n + 1;
        }
      }

      const currentPeak = runtime.volumeRisePeakDb ?? frame.rms;
      runtime.volumeRisePeakDb = Math.max(currentPeak, frame.rms);
    }

    const anchorReady = runtime.volumeRiseAnchorDb !== null && runtime.volumeRiseAnchorFrameCount >= rules.rmsAnchorFrames;
    const pitchAnchorReady = runtime.volumeRiseAnchorFrequencyHz !== null && runtime.volumeRisePitchFrameCount >= rules.pitchAnchorFrames;

    let pitchStableOk = false;
    if (pitchAnchorReady && frame.frequency > 0 && runtime.volumeRiseAnchorFrequencyHz) {
      const centsFromAnchor = 1200 * Math.log2(frame.frequency / runtime.volumeRiseAnchorFrequencyHz);
      pitchStableOk = Number.isFinite(centsFromAnchor) && Math.abs(centsFromAnchor) <= rules.pitchToleranceCents;
    }

    const riseOk =
      anchorReady &&
      runtime.volumeRisePeakDb !== null &&
      runtime.volumeRiseAnchorDb !== null &&
      runtime.volumeRisePeakDb - runtime.volumeRiseAnchorDb >= rules.rmsRiseMinDb;

    if (riseOk) {
      runtime.volumeRisePeakReached = true;
    }

    const primaryOk = pitchStableOk && (riseOk || runtime.volumeRisePeakReached);

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
    const rules = definition.rules as VolumeRiseRules;
    const requiredFrames = rules.minSamples;
    const completionRatio = requiredFrames > 0 ? Math.min(1, validFrames / requiredFrames) : 0;

    return {
      passed: validFrames >= requiredFrames && !!runtime?.volumeRisePeakReached,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
