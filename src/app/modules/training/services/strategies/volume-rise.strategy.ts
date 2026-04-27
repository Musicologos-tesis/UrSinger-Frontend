import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
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
  private readonly MIN_POWER_BOOST_DB = 0.9;
  private readonly MAX_POWER_BOOST_DB = 2.2;
  private readonly RELEASE_MARGIN_DB = 0.6;

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['volume-rise'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: VolumeRiseRules = {
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
      rmsRiseMinDb: levelConfig.rmsRiseMinDb,
      holdDurationMs: levelConfig.holdDurationSec * 1000,
      requiredRepetitions: levelConfig.requiredRepetitions,
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
    const requiredPowerBoostDb = this.getRequiredPowerBoost(rules.rmsRiseMinDb);
    const powerThresholdDb = rules.minVoiceRmsDb + requiredPowerBoostDb;
    const releaseThresholdDb = powerThresholdDb - this.RELEASE_MARGIN_DB;

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
      runtime.volumeRiseAwaitingRelease = false;
      runtime.volumeRiseCurrentHoldMs = 0;
      runtime.volumeRiseLastValidMs = null;

      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    if (runtime.volumeRiseAwaitingRelease) {
      const readyForNextBurst = frame.rms <= releaseThresholdDb;

      if (readyForNextBurst) {
        runtime.volumeRiseAwaitingRelease = false;
        runtime.volumeRiseAnchorDb = frame.rms;
        runtime.volumeRiseAnchorFrameCount = 1;
        runtime.volumeRiseAnchorFrequencyHz = frame.frequency;
        runtime.volumeRisePitchFrameCount = 1;
        runtime.volumeRisePeakDb = frame.rms;
        runtime.volumeRiseCurrentHoldMs = 0;
        runtime.volumeRiseLastValidMs = frame.timestamp;
      }

      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    if (voiceDetected && edgeConfidenceOk) {
      if (runtime.volumeRiseAnchorDb === null) {
        runtime.volumeRiseAnchorDb = frame.rms;
        runtime.volumeRiseAnchorFrameCount = 1;
        runtime.volumeRiseAnchorFrequencyHz = frame.frequency;
        runtime.volumeRisePitchFrameCount = 1;
        runtime.volumeRisePeakDb = frame.rms;
        runtime.volumeRiseLastValidMs = frame.timestamp;
      } else {
        if (runtime.volumeRiseAnchorFrameCount < rules.rmsAnchorFrames) {
          const n = runtime.volumeRiseAnchorFrameCount;
          runtime.volumeRiseAnchorDb = (runtime.volumeRiseAnchorDb * n + frame.rms) / (n + 1);
          runtime.volumeRiseAnchorFrameCount = n + 1;
        }

        if (frame.frequency > 0) {
          if (runtime.volumeRiseAnchorFrequencyHz === null) {
            runtime.volumeRiseAnchorFrequencyHz = frame.frequency;
            runtime.volumeRisePitchFrameCount = 1;
          } else if (runtime.volumeRisePitchFrameCount < rules.rmsAnchorFrames) {
            const n = runtime.volumeRisePitchFrameCount;
            runtime.volumeRiseAnchorFrequencyHz = (runtime.volumeRiseAnchorFrequencyHz * n + frame.frequency) / (n + 1);
            runtime.volumeRisePitchFrameCount = n + 1;
          }
        }

        runtime.volumeRisePeakDb = Math.max(runtime.volumeRisePeakDb ?? frame.rms, frame.rms);
      }
    }

    const anchorReady = runtime.volumeRiseAnchorDb !== null && runtime.volumeRiseAnchorFrameCount >= rules.rmsAnchorFrames;
    const pitchAnchorReady = runtime.volumeRiseAnchorFrequencyHz !== null && runtime.volumeRisePitchFrameCount >= rules.rmsAnchorFrames;

    let pitchStableOk = false;
    if (pitchAnchorReady && frame.frequency > 0 && runtime.volumeRiseAnchorFrequencyHz) {
      const centsFromAnchor = 1200 * Math.log2(frame.frequency / runtime.volumeRiseAnchorFrequencyHz);
      pitchStableOk = Number.isFinite(centsFromAnchor) && Math.abs(centsFromAnchor) <= rules.pitchToleranceCents;
    }

    const powerOk = frame.rms >= powerThresholdDb;
    const holdActive = anchorReady && pitchStableOk && powerOk;

    if (holdActive) {
      if (runtime.volumeRiseLastValidMs === null) {
        runtime.volumeRiseLastValidMs = frame.timestamp;
      } else {
        const deltaMs = Math.max(0, frame.timestamp - runtime.volumeRiseLastValidMs);
        runtime.volumeRiseCurrentHoldMs += deltaMs;
        runtime.volumeRiseLastValidMs = frame.timestamp;
      }

      const riseOk =
        runtime.volumeRisePeakDb !== null &&
        runtime.volumeRiseAnchorDb !== null &&
        runtime.volumeRisePeakDb - runtime.volumeRiseAnchorDb >= requiredPowerBoostDb;

      if (runtime.volumeRiseCurrentHoldMs >= rules.holdDurationMs && riseOk) {
        runtime.volumeRiseRepetitions += 1;
        runtime.volumeRiseAwaitingRelease = true;
      }
    } else if (runtime.volumeRiseLastValidMs !== null) {
      const dropMs = Math.max(0, frame.timestamp - runtime.volumeRiseLastValidMs);
      if (dropMs > 250) {
        runtime.volumeRiseCurrentHoldMs = 0;
        runtime.volumeRiseLastValidMs = null;
      }
    }

    const primaryOk = pitchStableOk && powerOk && anchorReady;

    if (primaryOk) {
      runtime.volumeRisePeakReached = true;
    }

    return {
      checks: {
        voiceDetected,
        edgeConfidenceOk,
        primaryOk,
      },
      isValidFrame: voiceDetected && edgeConfidenceOk && primaryOk && !runtime.volumeRiseAwaitingRelease,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    const rules = definition.rules as VolumeRiseRules;
    const repetitions = runtime?.volumeRiseRepetitions ?? 0;
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

  private getRequiredPowerBoost(rmsRiseMinDb: number): number {
    return Math.min(this.MAX_POWER_BOOST_DB, Math.max(this.MIN_POWER_BOOST_DB, rmsRiseMinDb * 0.35));
  }
}
