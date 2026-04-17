import { AudioPitchService } from '../../../checkup/services/audio-pitch.service';
import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  BreathFlowHoldRules,
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class BreathFlowHoldStrategy implements ExerciseStrategy {
  readonly kind = 'breath-flow-hold' as const;

  constructor(
    private readonly voiceDetection: VoiceDetectionService,
    private readonly pitchService: AudioPitchService
  ) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['breath-flow-hold'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: BreathFlowHoldRules = {
      targetMidi: exercise.targetMidi,
      targetFrequencyHz: this.pitchService.midiToFrequency(exercise.targetMidi),
      pitchToleranceCents: levelConfig.pitchToleranceCents,
      minSamples: levelConfig.minSamples,
      requiredHoldMs: levelConfig.requiredHoldSec * 1000,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
      rmsStabilityToleranceDb: levelConfig.rmsStabilityToleranceDb,
      rmsAnchorFrames: levelConfig.rmsAnchorFrames,
    };

    return {
      id: exercise.id,
      kind: 'breath-flow-hold',
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
    const rules = definition.rules as BreathFlowHoldRules;

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
      if (runtime.rmsAnchorDb === null) {
        runtime.rmsAnchorDb = frame.rms;
        runtime.rmsAnchorFrameCount = 1;
      } else if (runtime.rmsAnchorFrameCount < rules.rmsAnchorFrames) {
        const n = runtime.rmsAnchorFrameCount;
        runtime.rmsAnchorDb = (runtime.rmsAnchorDb * n + frame.rms) / (n + 1);
        runtime.rmsAnchorFrameCount = n + 1;
      }
    }

    const rmsAnchorReady = runtime.rmsAnchorFrameCount >= rules.rmsAnchorFrames;
    const rmsDelta = runtime.rmsAnchorDb === null ? Number.POSITIVE_INFINITY : Math.abs(frame.rms - runtime.rmsAnchorDb);
    const rmsOk = rmsAnchorReady && Number.isFinite(rmsDelta) && rmsDelta <= rules.rmsStabilityToleranceDb;

    const centsFromTarget =
      frame.frequency > 0 && rules.targetFrequencyHz > 0
        ? 1200 * Math.log2(frame.frequency / rules.targetFrequencyHz)
        : Number.POSITIVE_INFINITY;
    const pitchOk = Number.isFinite(centsFromTarget) && Math.abs(centsFromTarget) <= rules.pitchToleranceCents;

    const primaryOk = rmsOk && pitchOk;
    const validFrame = voiceDetected && edgeConfidenceOk && primaryOk;

    if (validFrame) {
      if (runtime.breathHoldCurrentStartMs === null) {
        runtime.breathHoldCurrentStartMs = frame.timestamp;
      }
      const streakMs = frame.timestamp - runtime.breathHoldCurrentStartMs;
      runtime.breathHoldMaxMs = Math.max(runtime.breathHoldMaxMs, streakMs);
    } else {
      runtime.breathHoldCurrentStartMs = null;
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
    const rules = definition.rules as BreathFlowHoldRules;
    const requiredFrames = rules.minSamples;
    const holdGoalMet = (runtime?.breathHoldMaxMs ?? 0) >= rules.requiredHoldMs;
    const completionRatio = rules.requiredHoldMs > 0
      ? Math.min(1, (runtime?.breathHoldMaxMs ?? 0) / rules.requiredHoldMs)
      : 0;

    return {
      passed: holdGoalMet,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
