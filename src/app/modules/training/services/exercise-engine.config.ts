import { ExerciseKind } from './exercise-engine.models';

export const EXERCISE_NAME_KIND_PATTERNS: Array<{ pattern: RegExp; kind: ExerciseKind }> = [
  { pattern: /pitch\s*target/i, kind: 'pitch-target' },
  { pattern: /steady\s*tone/i, kind: 'steady-tone' },
  { pattern: /breath\s*flow\s*hold/i, kind: 'breath-flow-hold' },
  { pattern: /dynamic\s*wave/i, kind: 'dynamic-wave' },
  { pattern: /volume\s*rise/i, kind: 'volume-rise' },
  { pattern: /loud\s*[–-]\s*soft\s*alternance/i, kind: 'loud-soft-alternance' },
  { pattern: /single\s*burst/i, kind: 'single-burst' },
  { pattern: /clean\s*onset/i, kind: 'clean-onset' },
  { pattern: /controlled\s*vibrato/i, kind: 'controlled-vibrato' },
  { pattern: /s\s*[–-]\s*z\s*balance/i, kind: 's-z-balance' },
  { pattern: /pitch\s*steps/i, kind: 'pitch-steps' },
  { pattern: /step\s*expansion/i, kind: 'step-expansion' },
  { pattern: /pitch\s*glide/i, kind: 'pitch-glide' },
  { pattern: /vocal\s*glide/i, kind: 'pitch-glide' },
  { pattern: /mix\s*coordination/i, kind: 'mix-coordination' },
];

export function resolveExerciseKindFromName(exerciseName: string): ExerciseKind | null {
  for (const matcher of EXERCISE_NAME_KIND_PATTERNS) {
    if (matcher.pattern.test(exerciseName)) {
      return matcher.kind;
    }
  }
  return null;
}

export const VOICE_FILTER_DEFAULTS = {
  minFrequencyHz: 80,
  maxFrequencyHz: 880,
  edgeFrequencyLowHz: 100,
  edgeFrequencyHighHz: 700,
  minEdgeConfidence: 0.15,
} as const;

export const LEVEL_CONFIGS = {
  'pitch-target': {
    1: { durationSec: 60, minSamples: 30, toleranceCents: 50, holdDurationSec: 3, requiredRepetitions: 3 },
    2: { durationSec: 60, minSamples: 35, toleranceCents: 25, holdDurationSec: 3, requiredRepetitions: 3 },
  },
  'steady-tone': {
    1: { durationSec: 60, minSamples: 30, toleranceCents: 40, holdDurationSec: 3, requiredRepetitions: 3 },
    2: { durationSec: 60, minSamples: 45, toleranceCents: 25, holdDurationSec: 5, requiredRepetitions: 3 },
  },
  'pitch-steps': {
    1: {
      durationSec: 60,
      intervalSemitones: 2,
      toleranceCents: 55,
      minSamplesPerStep: 8,
      noteHoldSec: 1,
      requiredRepetitions: 3,
    },
    2: {
      durationSec: 60,
      intervalSemitones: 5,
      toleranceCents: 38,
      minSamplesPerStep: 11,
      noteHoldSec: 1,
      requiredRepetitions: 3,
    },
  },
  'step-expansion': {
    1: { durationSec: 60, semitoneSpan: 3, noteCount: 3, requiredRepetitions: 3, toleranceCents: 55, minSamplesPerStep: 6 },
    2: { durationSec: 60, semitoneSpan: 5, noteCount: 5, requiredRepetitions: 3, toleranceCents: 38, minSamplesPerStep: 7 },
  },
  'pitch-glide': {
    1: {
      durationSec: 60,
      glideSpanSemitones: 3,
      requiredRepetitions: 3,
      endToleranceCents: 60,
      minSamples: 20,
    },
    2: {
      durationSec: 60,
      glideSpanSemitones: 6,
      requiredRepetitions: 3,
      endToleranceCents: 45,
      minSamples: 32,
    },
  },
  'vocal-glide': {
    1: { durationSec: 60, glideSpanSemitones: 5, requiredRepetitions: 3, endToleranceCents: 60, minSamples: 24 },
    2: { durationSec: 60, glideSpanSemitones: 8, requiredRepetitions: 3, endToleranceCents: 45, minSamples: 38 },
  },
  'mix-coordination': {
    1: {
      durationSec: 60,
      glideSpanSemitones: 3,
      requiredRepetitions: 3,
      endToleranceCents: 50,
      mixWindowToleranceCents: 75,
      minTransitionSamples: 4,
      minSamples: 24,
    },
    2: {
      durationSec: 60,
      glideSpanSemitones: 5,
      requiredRepetitions: 3,
      endToleranceCents: 35,
      mixWindowToleranceCents: 55,
      minTransitionSamples: 7,
      minSamples: 36,
    },
  },
  'breath-flow-hold': {
    1: {
      durationSec: 30,
      minSamples: 30,
      requiredHoldSec: 3,
      pitchToleranceCents: 55,
      rmsStabilityToleranceDb: 4,
      rmsAnchorFrames: 5,
    },
    2: {
      durationSec: 30,
      minSamples: 50,
      requiredHoldSec: 5,
      pitchToleranceCents: 45,
      rmsStabilityToleranceDb: 3,
      rmsAnchorFrames: 6,
    },
  },
  's-z-balance': {
    1: {
      durationSec: 30,
      minSamples: 20,
      toleranceSemitones: 3,
      maxExtraHoldSeconds: 30,
    },
    2: {
      durationSec: 30,
      minSamples: 30,
      toleranceSemitones: 1,
      maxExtraHoldSeconds: 30,
    },
  },
  'dynamic-wave': {
    1: {
      durationSec: 60,
      minSamples: 45,
      requiredCycles: 3,
      pitchToleranceCents: 55,
      rmsAnchorFrames: 6,
      rmsRiseMinDb: 4,
      rmsReturnToleranceDb: 2.8,
    },
    2: {
      durationSec: 60,
      minSamples: 55,
      requiredCycles: 3,
      pitchToleranceCents: 50,
      rmsAnchorFrames: 7,
      rmsRiseMinDb: 5,
      rmsReturnToleranceDb: 2.3,
    },
  },
  'volume-rise': {
    1: {
      durationSec: 60,
      minSamples: 20,
      rmsAnchorFrames: 5,
      pitchToleranceCents: 45,
      rmsRiseMinDb: 4,
      holdDurationSec: 3,
      requiredRepetitions: 3,
    },
    2: {
      durationSec: 60,
      minSamples: 35,
      rmsAnchorFrames: 6,
      pitchToleranceCents: 30,
      rmsRiseMinDb: 5,
      holdDurationSec: 5,
      requiredRepetitions: 3,
    },
  },
  'loud-soft-alternance': {
    1: {
      durationSec: 60,
      minSamples: 20,
      rmsAnchorFrames: 5,
      pitchToleranceCents: 45,
      loudDeltaDb: 4,
      softReturnToleranceDb: 2.8,
      requiredCycles: 3,
    },
    2: {
      durationSec: 60,
      minSamples: 35,
      rmsAnchorFrames: 6,
      pitchToleranceCents: 30,
      loudDeltaDb: 5,
      softReturnToleranceDb: 2.3,
      requiredCycles: 3,
    },
  },
  'single-burst': {
    1: {
      durationSec: 60,
      minSamples: 20,
      toleranceCents: 45,
      rmsAnchorFrames: 5,
      minAttackDeltaDb: 4,
      requiredRepetitions: 3,
    },
    2: {
      durationSec: 60,
      minSamples: 35,
      toleranceCents: 30,
      rmsAnchorFrames: 6,
      minAttackDeltaDb: 5,
      requiredRepetitions: 3,
    },
  },
  'clean-onset': {
    1: {
      durationSec: 60,
      minSamples: 24,
      toleranceCents: 50,
      maxOnsetLatencyMs: 220,
      requiredRepetitions: 3,
    },
    2: {
      durationSec: 60,
      minSamples: 30,
      toleranceCents: 25,
      maxOnsetLatencyMs: 160,
      requiredRepetitions: 3,
    },
  },
  'controlled-vibrato': {
    1: {
      durationSec: 60,
      minSamples: 20,
      requiredHoldSec: 3,
      anchorFrames: 5,
      minPeakToPeakCents: 30,
      maxPeakToPeakCents: 220,
      minDirectionChanges: 3,
      centerDriftToleranceCents: 40,
    },
    2: {
      durationSec: 60,
      minSamples: 35,
      requiredHoldSec: 5,
      anchorFrames: 6,
      minPeakToPeakCents: 40,
      maxPeakToPeakCents: 190,
      minDirectionChanges: 5,
      centerDriftToleranceCents: 30,
    },
  },
} as const;
