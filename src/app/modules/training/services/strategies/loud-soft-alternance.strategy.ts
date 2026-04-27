import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  LoudSoftAlternanceRules,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class LoudSoftAlternanceStrategy implements ExerciseStrategy {
  readonly kind = 'loud-soft-alternance' as const;

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['loud-soft-alternance'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: LoudSoftAlternanceRules = {
      targetMidi: exercise.targetMidi,
      targetFrequencyHz: this.pitchService.midiToFrequency(exercise.targetMidi),
      minSamples: levelConfig.minSamples,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
      rmsAnchorFrames: levelConfig.rmsAnchorFrames,
      pitchToleranceCents: levelConfig.pitchToleranceCents,
      loudDeltaDb: levelConfig.loudDeltaDb,
      softReturnToleranceDb: levelConfig.softReturnToleranceDb,
      requiredCycles: levelConfig.requiredCycles,
    };

    return {
      id: exercise.id,
      kind: 'loud-soft-alternance',
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
    const rules = definition.rules as LoudSoftAlternanceRules;

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
      if (runtime.alternanceAnchorDb === null) {
        runtime.alternanceAnchorDb = frame.rms;
        runtime.alternanceAnchorFrameCount = 1;
      } else if (runtime.alternanceAnchorFrameCount < rules.rmsAnchorFrames) {
        const n = runtime.alternanceAnchorFrameCount;
        runtime.alternanceAnchorDb = (runtime.alternanceAnchorDb * n + frame.rms) / (n + 1);
        runtime.alternanceAnchorFrameCount = n + 1;
      }

      runtime.alternanceAnchorFrequencyHz = rules.targetFrequencyHz;
      runtime.alternancePitchFrameCount = rules.rmsAnchorFrames;
    }

    const anchorReady = runtime.alternanceAnchorDb !== null && runtime.alternanceAnchorFrameCount >= rules.rmsAnchorFrames;
    const centsFromTarget =
      frame.frequency > 0 && rules.targetFrequencyHz > 0
        ? 1200 * Math.log2(frame.frequency / rules.targetFrequencyHz)
        : Number.POSITIVE_INFINITY;
    const pitchStableOk = Number.isFinite(centsFromTarget) && Math.abs(centsFromTarget) <= rules.pitchToleranceCents;

    if (!voiceDetected || !edgeConfidenceOk || !anchorReady || !pitchStableOk || runtime.alternanceAnchorDb === null) {
      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    const anchorDb = runtime.alternanceAnchorDb;

    if (runtime.alternancePhase === 'loud') {
      const currentPeak = runtime.alternancePeakDb ?? frame.rms;
      runtime.alternancePeakDb = Math.max(currentPeak, frame.rms);

      const reachedLoud = runtime.alternancePeakDb - anchorDb >= rules.loudDeltaDb;
      if (reachedLoud) {
        runtime.alternancePhase = 'soft';
      }

      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: pitchStableOk,
        },
        isValidFrame: pitchStableOk,
      };
    }

    if (runtime.alternancePhase === 'soft') {
      const returnedSoft = Math.abs(frame.rms - anchorDb) <= rules.softReturnToleranceDb;

      if (returnedSoft) {
        runtime.alternanceCyclesCompleted++;
        if (runtime.alternanceCyclesCompleted >= rules.requiredCycles) {
          runtime.alternancePhase = 'complete';
        } else {
          runtime.alternancePhase = 'loud';
          runtime.alternancePeakDb = null;
        }
      }

      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: pitchStableOk,
        },
        isValidFrame: pitchStableOk,
      };
    }

    return {
      checks: {
        voiceDetected,
        edgeConfidenceOk,
        primaryOk: true,
      },
      isValidFrame: true,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    const rules = definition.rules as LoudSoftAlternanceRules;
    const requiredFrames = rules.minSamples;
    const completionRatio = requiredFrames > 0 ? Math.min(1, validFrames / requiredFrames) : 0;

    return {
      passed: validFrames >= requiredFrames && (runtime?.alternanceCyclesCompleted ?? 0) >= rules.requiredCycles,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
