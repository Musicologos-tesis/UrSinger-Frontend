import { ExerciseKind } from './exercise-engine.models';

export const EXERCISE_NAME_KIND_PATTERNS: Array<{ pattern: RegExp; kind: ExerciseKind }> = [
  { pattern: /pitch\s*target/i, kind: 'pitch-target' },
  { pattern: /steady\s*tone/i, kind: 'steady-tone' },
  { pattern: /breath\s*flow\s*hold/i, kind: 'breath-flow-hold' },
  { pattern: /dynamic\s*wave/i, kind: 'dynamic-wave' },
  { pattern: /s\s*[–-]\s*z\s*balance/i, kind: 's-z-balance' },
  { pattern: /pitch\s*steps/i, kind: 'pitch-steps' },
  { pattern: /pitch\s*glide/i, kind: 'pitch-glide' },
  { pattern: /vocal\s*glide/i, kind: 'pitch-glide' },
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
    1: { durationSec: 3, minSamples: 20, toleranceCents: 50 },
    2: { durationSec: 5, minSamples: 35, toleranceCents: 25 },
  },
  'steady-tone': {
    1: { durationSec: 3, minSamples: 20, toleranceCents: 40, anchorFrames: 5 },
    2: { durationSec: 5, minSamples: 35, toleranceCents: 25, anchorFrames: 6 },
  },
  'pitch-steps': {
    1: { durationSec: 4, intervalSemitones: 2, toleranceCents: 45, minSamplesPerStep: 10 },
    2: { durationSec: 6, intervalSemitones: 5, toleranceCents: 30, minSamplesPerStep: 14 },
  },
  'pitch-glide': {
    1: { durationSec: 4, glideSpanSemitones: 3, endToleranceCents: 50, minSamples: 24 },
    2: { durationSec: 6, glideSpanSemitones: 6, endToleranceCents: 35, minSamples: 40 },
  },
  'breath-flow-hold': {
    1: { durationSec: 3, minSamples: 20, rmsStabilityToleranceDb: 4, rmsAnchorFrames: 5 },
    2: { durationSec: 5, minSamples: 35, rmsStabilityToleranceDb: 3, rmsAnchorFrames: 6 },
  },
  's-z-balance': {
    1: { durationSec: 6, minSamplesPerPhase: 20, minAirRmsDb: -58, maxSPhaseConfidence: 0.12 },
    2: { durationSec: 10, minSamplesPerPhase: 35, minAirRmsDb: -60, maxSPhaseConfidence: 0.1 },
  },
  'dynamic-wave': {
    1: { durationSec: 3, minSamples: 20, rmsAnchorFrames: 5, rmsRiseMinDb: 4, rmsReturnToleranceDb: 2.8 },
    2: { durationSec: 5, minSamples: 35, rmsAnchorFrames: 6, rmsRiseMinDb: 5, rmsReturnToleranceDb: 2.3 },
  },
} as const;
