import { VoiceDetectionService } from '../../../../services/voice-detection.service';
import { LEVEL_CONFIGS, VOICE_FILTER_DEFAULTS } from '../exercise-engine.config';
import {
  DynamicWaveRules,
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseResult,
  ExerciseRuntimeState,
  VoiceFrame,
} from '../exercise-engine.models';
import { ExerciseStrategy } from '../exercise-engine.strategy';

export class DynamicWaveStrategy implements ExerciseStrategy {
  readonly kind = 'dynamic-wave' as const;

  constructor(private readonly voiceDetection: VoiceDetectionService) {}

  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition {
    const normalized = exercise.level >= 2 ? 2 : 1;
    const levelConfig = LEVEL_CONFIGS['dynamic-wave'][normalized];
    const profile = this.voiceDetection.readVoiceProfile();

    const rules: DynamicWaveRules = {
      targetMidi: exercise.targetMidi,
      pitchToleranceCents: levelConfig.pitchToleranceCents,
      requiredCycles: levelConfig.requiredCycles,
      minSamples: levelConfig.minSamples,
      minVoiceRmsDb: profile?.avgMinRmsDb ?? -60,
      minFrequencyHz: VOICE_FILTER_DEFAULTS.minFrequencyHz,
      maxFrequencyHz: VOICE_FILTER_DEFAULTS.maxFrequencyHz,
      edgeFrequencyLowHz: VOICE_FILTER_DEFAULTS.edgeFrequencyLowHz,
      edgeFrequencyHighHz: VOICE_FILTER_DEFAULTS.edgeFrequencyHighHz,
      minEdgeConfidence: VOICE_FILTER_DEFAULTS.minEdgeConfidence,
      rmsAnchorFrames: levelConfig.rmsAnchorFrames,
      rmsRiseMinDb: levelConfig.rmsRiseMinDb,
      rmsReturnToleranceDb: levelConfig.rmsReturnToleranceDb,
    };

    return {
      id: exercise.id,
      kind: 'dynamic-wave',
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
    const rules = definition.rules as DynamicWaveRules;

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

    const pitchInTolerance =
      frame.midiNote > 0 &&
      Math.abs((frame.midiNote - rules.targetMidi) * 100) <= rules.pitchToleranceCents;

    if (voiceDetected && edgeConfidenceOk && pitchInTolerance) {
      if (runtime.dynamicAnchorDb === null) {
        runtime.dynamicAnchorDb = frame.rms;
        runtime.dynamicAnchorFrameCount = 1;
      } else if (runtime.dynamicAnchorFrameCount < rules.rmsAnchorFrames) {
        const n = runtime.dynamicAnchorFrameCount;
        runtime.dynamicAnchorDb = (runtime.dynamicAnchorDb * n + frame.rms) / (n + 1);
        runtime.dynamicAnchorFrameCount = n + 1;
      }
    }

    const anchorReady = runtime.dynamicAnchorFrameCount >= rules.rmsAnchorFrames;
    const pitchOk = voiceDetected && edgeConfidenceOk && pitchInTolerance;

    if (!pitchOk || !anchorReady || runtime.dynamicAnchorDb === null) {
      return {
        checks: {
          voiceDetected,
          edgeConfidenceOk,
          primaryOk: false,
        },
        isValidFrame: false,
      };
    }

    const anchorDb = runtime.dynamicAnchorDb;
    const peakDb = runtime.dynamicPeakDb ?? frame.rms;
    runtime.dynamicPeakDb = Math.max(peakDb, frame.rms);

    let primaryOk = false;

    if (runtime.dynamicPhase === 'rise') {
      primaryOk = frame.rms >= anchorDb - 2;

      if (runtime.dynamicPeakDb - anchorDb >= rules.rmsRiseMinDb) {
        runtime.dynamicPeakReached = true;
        runtime.dynamicPhase = 'fall';
      }
    } else if (runtime.dynamicPhase === 'fall') {
      const droppedFromPeak = frame.rms <= (runtime.dynamicPeakDb - Math.max(2, rules.rmsRiseMinDb * 0.6));
      const returnedNearAnchor = Math.abs(frame.rms - anchorDb) <= rules.rmsReturnToleranceDb;
      primaryOk = droppedFromPeak || returnedNearAnchor;

      if (returnedNearAnchor) {
        runtime.dynamicReturned = true;
        runtime.dynamicCyclesCompleted += 1;

        if (runtime.dynamicCyclesCompleted >= rules.requiredCycles) {
          runtime.dynamicPhase = 'complete';
        } else {
          runtime.dynamicPhase = 'rise';
          runtime.dynamicAnchorDb = frame.rms;
          runtime.dynamicAnchorFrameCount = 1;
          runtime.dynamicPeakDb = frame.rms;
          runtime.dynamicPeakReached = false;
          runtime.dynamicReturned = false;
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
      isValidFrame: pitchOk && primaryOk,
    };
  }

  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult {
    const rules = definition.rules as DynamicWaveRules;
    const requiredFrames = rules.minSamples;
    const completionRatio = requiredFrames > 0 ? Math.min(1, validFrames / requiredFrames) : 0;
    const cyclesCompleted = runtime?.dynamicCyclesCompleted ?? 0;
    const waveCompleted = cyclesCompleted >= rules.requiredCycles;

    return {
      passed: waveCompleted,
      validFrames,
      requiredFrames,
      completionRatio,
      score: Math.round(completionRatio * 100),
    };
  }
}
