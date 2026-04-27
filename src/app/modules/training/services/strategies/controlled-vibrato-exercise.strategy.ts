import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  ControlledVibratoRules,
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class ControlledVibratoStrategy implements ExerciseStrategy {
  readonly kind = 'controlled-vibrato' as const;
  private readonly MAX_BRIEF_DROP_MS = 350;
  private readonly MAX_TARGET_GAP_MS = 550;

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['controlled-vibrato'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: ControlledVibratoRules = {
      targetMidi: exercise.targetMidi,
      targetFrequencyHz: this.pitchService.midiToFrequency(exercise.targetMidi),
      requiredHoldMs: levelConfig.requiredHoldSec * 1000,
      minSamples: levelConfig.minSamples,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
      anchorFrames: levelConfig.anchorFrames,
      minPeakToPeakCents: levelConfig.minPeakToPeakCents,
      maxPeakToPeakCents: levelConfig.maxPeakToPeakCents,
      minDirectionChanges: levelConfig.minDirectionChanges,
      centerDriftToleranceCents: levelConfig.centerDriftToleranceCents,
    };

    return {
      id: exercise.id,
      kind: 'controlled-vibrato',
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
    const rules = definition.rules as ControlledVibratoRules;

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

    if (!voiceDetected || !edgeConfidenceOk || frame.frequency <= 0) {
      this.resetHoldIfDropExceeded(runtime, frame.timestamp);
      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    const centsFromTarget = 1200 * Math.log2(frame.frequency / rules.targetFrequencyHz);
    const allowedCenterDeviation = rules.centerDriftToleranceCents + rules.maxPeakToPeakCents / 2;
    const primaryOk = Number.isFinite(centsFromTarget) && Math.abs(centsFromTarget) <= allowedCenterDeviation;

    if (!primaryOk) {
      this.resetHoldIfDropExceeded(runtime, frame.timestamp);
      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk,
        },
        isValidFrame: false,
      };
    }

    const nearTargetToleranceCents = Math.max(18, Math.round(rules.centerDriftToleranceCents * 0.6));
    const nearTarget = Math.abs(centsFromTarget) <= nearTargetToleranceCents;

    if (nearTarget && !runtime.controlledVibratoWasNearTarget && runtime.controlledVibratoLastTargetMs !== null) {
      runtime.controlledVibratoTargetReturns += 1;
    }

    if (nearTarget) {
      runtime.controlledVibratoLastTargetMs = frame.timestamp;
    }
    runtime.controlledVibratoWasNearTarget = nearTarget;

    if (runtime.vibratoMaxCents === null || centsFromTarget > runtime.vibratoMaxCents) {
      runtime.vibratoMaxCents = centsFromTarget;
    }
    if (runtime.vibratoMinCents === null || centsFromTarget < runtime.vibratoMinCents) {
      runtime.vibratoMinCents = centsFromTarget;
    }

    const sign: -1 | 0 | 1 = centsFromTarget > 0 ? 1 : centsFromTarget < 0 ? -1 : 0;
    if (sign !== 0 && runtime.vibratoLastSign !== 0 && sign !== runtime.vibratoLastSign) {
      runtime.vibratoDirectionChanges += 1;
    }
    if (sign !== 0) {
      runtime.vibratoLastSign = sign;
    }

    const recentTargetHeard =
      runtime.controlledVibratoLastTargetMs !== null &&
      Math.max(0, frame.timestamp - runtime.controlledVibratoLastTargetMs) <= this.MAX_TARGET_GAP_MS;

    const requiredTargetReturns = rules.requiredHoldMs >= 5000 ? 2 : 1;
    const intermittentTargetOk = runtime.controlledVibratoTargetReturns >= requiredTargetReturns;
    const validVibratoFrame = recentTargetHeard && intermittentTargetOk;

    if (validVibratoFrame) {
      if (runtime.controlledVibratoLastValidMs === null) {
        runtime.controlledVibratoLastValidMs = frame.timestamp;
      } else {
        const deltaMs = Math.max(0, frame.timestamp - runtime.controlledVibratoLastValidMs);
        runtime.controlledVibratoHoldMs += deltaMs;
        runtime.controlledVibratoLastValidMs = frame.timestamp;
      }
    } else {
      this.resetHoldIfDropExceeded(runtime, frame.timestamp);
    }

    return {
      checks: {
        voiceDetected,
        edgeConfidenceOk,
        primaryOk: validVibratoFrame,
      },
      isValidFrame: validVibratoFrame,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    const rules = definition.rules as ControlledVibratoRules;
    const requiredFrames = rules.minSamples;
    const completionRatio = requiredFrames > 0 ? Math.min(1, validFrames / requiredFrames) : 0;
    const holdOk = (runtime?.controlledVibratoHoldMs ?? 0) >= rules.requiredHoldMs;
    const requiredTargetReturns = rules.requiredHoldMs >= 5000 ? 2 : 1;
    const intermittentTargetOk = (runtime?.controlledVibratoTargetReturns ?? 0) >= requiredTargetReturns;

    return {
      passed: validFrames >= requiredFrames && holdOk && intermittentTargetOk,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }

  private resetHoldIfDropExceeded(runtime: ExerciseRuntimeState, nowMs: number): void {
    if (runtime.controlledVibratoLastValidMs === null) {
      runtime.controlledVibratoHoldMs = 0;
      return;
    }

    const invalidGapMs = Math.max(0, nowMs - runtime.controlledVibratoLastValidMs);
    if (invalidGapMs > this.MAX_BRIEF_DROP_MS) {
      runtime.controlledVibratoHoldMs = 0;
      runtime.controlledVibratoLastValidMs = null;
      runtime.controlledVibratoTargetReturns = 0;
      runtime.controlledVibratoLastTargetMs = null;
      runtime.controlledVibratoWasNearTarget = false;
    }
  }
}
