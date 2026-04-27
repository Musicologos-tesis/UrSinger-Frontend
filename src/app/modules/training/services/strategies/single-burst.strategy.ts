import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  SingleBurstRules,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class SingleBurstStrategy implements ExerciseStrategy {
  readonly kind = 'single-burst' as const;
  private readonly MIN_POWER_BOOST_DB = 0.9;
  private readonly MAX_POWER_BOOST_DB = 2.2;
  private readonly RELEASE_MARGIN_DB = 0.6;
  private readonly DEBUG_STORAGE_KEY = 'ursinger.debug.singleBurst';
  private readonly DEBUG_THROTTLE_MS = 350;
  private lastDebugAtMs = 0;
  private lastDebugSignature = '';

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['single-burst'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: SingleBurstRules = {
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
      rmsAnchorFrames: levelConfig.rmsAnchorFrames,
      minAttackDeltaDb: levelConfig.minAttackDeltaDb,
    };

    return {
      id: exercise.id,
      kind: 'single-burst',
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
    const rules = definition.rules as SingleBurstRules;
    const requiredPowerBoostDb = this.getRequiredPowerBoost(rules.minAttackDeltaDb);
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

    const isAboveNoise = frame.rms > rules.minVoiceRmsDb;
    const isInRange = frame.frequency >= rules.minFrequencyHz && frame.frequency <= rules.maxFrequencyHz;
    const hasPitchData = frame.frequency > 0 && frame.midiNote > 0;

    if (!voiceDetected) {
      runtime.singleBurstAwaitingRelease = false;

      this.debugFrame(frame, {
        voiceDetected,
        edgeConfidenceOk,
        isAboveNoise,
        isInRange,
        hasPitchData,
        waitingRelease: runtime.singleBurstAwaitingRelease,
        repetitions: runtime.singleBurstRepetitions,
        powerThresholdDb: this.round(powerThresholdDb),
        reason: 'invalid-voice-frame',
      });

      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    if (runtime.singleBurstAwaitingRelease) {
      const readyForNextBurst = frame.rms <= releaseThresholdDb;

      if (readyForNextBurst) {
        runtime.singleBurstAwaitingRelease = false;

        this.debugEvent('release-ready', {
          rms: this.round(frame.rms),
          releaseThresholdDb: this.round(releaseThresholdDb),
          repetitions: runtime.singleBurstRepetitions,
        });
      }

      this.debugFrame(frame, {
        voiceDetected,
        edgeConfidenceOk,
        isAboveNoise,
        isInRange,
        hasPitchData,
        waitingRelease: runtime.singleBurstAwaitingRelease,
        repetitions: runtime.singleBurstRepetitions,
        powerThresholdDb: this.round(powerThresholdDb),
        releaseThresholdDb: this.round(releaseThresholdDb),
        reason: readyForNextBurst ? 'release-detected' : 'awaiting-release',
      });

      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    const centsFromTarget =
      frame.frequency > 0 && rules.targetFrequencyHz > 0
        ? 1200 * Math.log2(frame.frequency / rules.targetFrequencyHz)
        : Number.POSITIVE_INFINITY;

    const pitchOk = Number.isFinite(centsFromTarget) && Math.abs(centsFromTarget) <= rules.toleranceCents;
    const powerOk = frame.rms >= powerThresholdDb;
    const primaryOk = voiceDetected && edgeConfidenceOk && pitchOk && powerOk;

    this.debugFrame(frame, {
      voiceDetected,
      edgeConfidenceOk,
      isAboveNoise,
      isInRange,
      hasPitchData,
      waitingRelease: runtime.singleBurstAwaitingRelease,
      repetitions: runtime.singleBurstRepetitions,
      pitchOk,
      powerOk,
      centsFromTarget: this.round(centsFromTarget),
      rms: this.round(frame.rms),
      powerThresholdDb: this.round(powerThresholdDb),
      requiredPowerBoostDb: this.round(requiredPowerBoostDb),
      releaseThresholdDb: this.round(releaseThresholdDb),
      reason: primaryOk ? 'rep-counted' : 'conditions-not-met',
    });

    if (primaryOk) {
      runtime.singleBurstRepetitions += 1;
      runtime.singleBurstAwaitingRelease = true;

      this.debugEvent('repetition-counted', {
        repetitions: runtime.singleBurstRepetitions,
        required: rules.requiredRepetitions,
        rmsPeak: this.round(frame.rms),
      });
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
    const rules = definition.rules as SingleBurstRules;
    const repetitions = runtime?.singleBurstRepetitions ?? 0;
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

  private getRequiredPowerBoost(configuredDelta: number): number {
    const softBoost = configuredDelta * 0.35;
    return Math.min(this.MAX_POWER_BOOST_DB, Math.max(this.MIN_POWER_BOOST_DB, softBoost));
  }

  private isDebugEnabled(): boolean {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return false;
    }
    return globalThis.localStorage.getItem(this.DEBUG_STORAGE_KEY) === '1';
  }

  private debugEvent(event: string, payload: Record<string, unknown>): void {
    if (!this.isDebugEnabled()) {
      return;
    }
    console.log('[SingleBurst][debug]', event, payload);
  }

  private debugFrame(frame: VoiceFrame, payload: Record<string, unknown>): void {
    if (!this.isDebugEnabled()) {
      return;
    }

    const signature = `${payload['reason']}|${payload['voiceDetected']}|${payload['powerOk']}|${payload['pitchOk']}|${payload['waitingRelease']}|${payload['repetitions']}`;
    const nowMs = frame.timestamp;
    const shouldLog = signature !== this.lastDebugSignature || nowMs - this.lastDebugAtMs >= this.DEBUG_THROTTLE_MS;

    if (!shouldLog) {
      return;
    }

    this.lastDebugSignature = signature;
    this.lastDebugAtMs = nowMs;

    console.log('[SingleBurst][frame]', payload);
  }

  private round(value: number | null): number | null {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }
    return Math.round(value * 100) / 100;
  }
}
