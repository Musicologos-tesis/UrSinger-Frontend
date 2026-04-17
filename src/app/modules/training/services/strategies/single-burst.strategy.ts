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
      if (runtime.singleBurstAnchorDb === null) {
        runtime.singleBurstAnchorDb = frame.rms;
        runtime.singleBurstAnchorFrameCount = 1;
      } else if (runtime.singleBurstAnchorFrameCount < rules.rmsAnchorFrames) {
        const n = runtime.singleBurstAnchorFrameCount;
        runtime.singleBurstAnchorDb = (runtime.singleBurstAnchorDb * n + frame.rms) / (n + 1);
        runtime.singleBurstAnchorFrameCount = n + 1;
      }
    }

    const attackReady = runtime.singleBurstAnchorDb !== null && runtime.singleBurstAnchorFrameCount >= rules.rmsAnchorFrames;
    const attackReached =
      attackReady &&
      runtime.singleBurstAnchorDb !== null &&
      frame.rms - runtime.singleBurstAnchorDb >= rules.minAttackDeltaDb;

    if (attackReached) {
      runtime.singleBurstAttackReached = true;
    }

    const centsFromTarget =
      frame.frequency > 0 && rules.targetFrequencyHz > 0
        ? 1200 * Math.log2(frame.frequency / rules.targetFrequencyHz)
        : Number.POSITIVE_INFINITY;

    const pitchOk = Number.isFinite(centsFromTarget) && Math.abs(centsFromTarget) <= rules.toleranceCents;
    const primaryOk = pitchOk && (attackReached || runtime.singleBurstAttackReached);

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
    const rules = definition.rules as SingleBurstRules;
    const requiredFrames = rules.minSamples;
    const completionRatio = requiredFrames > 0 ? Math.min(1, validFrames / requiredFrames) : 0;

    return {
      passed: validFrames >= requiredFrames && !!runtime?.singleBurstAttackReached,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
