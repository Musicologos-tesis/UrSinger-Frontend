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
    1: { durationSec: 3, minSamples: 20, toleranceCents: 50 },
    2: { durationSec: 5, minSamples: 35, toleranceCents: 25 },
  },
  'steady-tone': {
    1: { durationSec: 3, minSamples: 20, toleranceCents: 40, anchorFrames: 5 },
    2: { durationSec: 5, minSamples: 35, toleranceCents: 25, anchorFrames: 6 },
  },
  'pitch-steps': {
    1: { durationSec: 4, intervalSemitones: 2, toleranceCents: 55, minSamplesPerStep: 8 },
    2: { durationSec: 6, intervalSemitones: 5, toleranceCents: 38, minSamplesPerStep: 11 },
  },
  'step-expansion': {
    1: { durationSec: 5, semitoneSpan: 3, noteCount: 3, toleranceCents: 55, minSamplesPerStep: 6 },
    2: { durationSec: 7, semitoneSpan: 5, noteCount: 5, toleranceCents: 38, minSamplesPerStep: 7 },
  },
  'pitch-glide': {
    1: { durationSec: 4, glideSpanSemitones: 3, endToleranceCents: 60, minSamples: 20 },
    2: { durationSec: 6, glideSpanSemitones: 6, endToleranceCents: 45, minSamples: 32 },
  },
  'vocal-glide': {
    1: { durationSec: 5, glideSpanSemitones: 5, endToleranceCents: 60, minSamples: 24 },
    2: { durationSec: 7, glideSpanSemitones: 8, endToleranceCents: 45, minSamples: 38 },
  },
  'mix-coordination': {
    1: {
      durationSec: 4,
      glideSpanSemitones: 3,
      endToleranceCents: 50,
      mixWindowToleranceCents: 75,
      minTransitionSamples: 4,
      minSamples: 24,
    },
    2: {
      durationSec: 6,
      glideSpanSemitones: 5,
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
      minSamples: 25,
      minAirRmsDb: -58,
      maxSPhaseConfidence: 0.12,
      minSPhaseDurationMs: 1000,
      phaseSilenceMs: 450,
      maxDurationDiffMs: 3000,
    },
    2: {
      durationSec: 30,
      minSamples: 35,
      minAirRmsDb: -60,
      maxSPhaseConfidence: 0.1,
      minSPhaseDurationMs: 1200,
      phaseSilenceMs: 450,
      maxDurationDiffMs: 1000,
    },
  },
  'dynamic-wave': {
    1: { durationSec: 3, minSamples: 20, rmsAnchorFrames: 5, rmsRiseMinDb: 4, rmsReturnToleranceDb: 2.8 },
    2: { durationSec: 5, minSamples: 35, rmsAnchorFrames: 6, rmsRiseMinDb: 5, rmsReturnToleranceDb: 2.3 },
  },
  'volume-rise': {
    1: {
      durationSec: 3,
      minSamples: 20,
      rmsAnchorFrames: 5,
      pitchAnchorFrames: 5,
      pitchToleranceCents: 45,
      rmsRiseMinDb: 4,
    },
    2: {
      durationSec: 5,
      minSamples: 35,
      rmsAnchorFrames: 6,
      pitchAnchorFrames: 6,
      pitchToleranceCents: 30,
      rmsRiseMinDb: 5,
    },
  },
  'loud-soft-alternance': {
    1: {
      durationSec: 3,
      minSamples: 20,
      rmsAnchorFrames: 5,
      pitchAnchorFrames: 5,
      pitchToleranceCents: 45,
      loudDeltaDb: 4,
      softReturnToleranceDb: 2.8,
      requiredCycles: 1,
    },
    2: {
      durationSec: 5,
      minSamples: 35,
      rmsAnchorFrames: 6,
      pitchAnchorFrames: 6,
      pitchToleranceCents: 30,
      loudDeltaDb: 5,
      softReturnToleranceDb: 2.3,
      requiredCycles: 2,
    },
  },
  'single-burst': {
    1: {
      durationSec: 3,
      minSamples: 20,
      toleranceCents: 45,
      rmsAnchorFrames: 5,
      minAttackDeltaDb: 4,
    },
    2: {
      durationSec: 5,
      minSamples: 35,
      toleranceCents: 30,
      rmsAnchorFrames: 6,
      minAttackDeltaDb: 5,
    },
  },
  'clean-onset': {
    1: {
      durationSec: 3,
      minSamples: 20,
      toleranceCents: 50,
      maxOnsetLatencyMs: 650,
    },
    2: {
      durationSec: 5,
      minSamples: 35,
      toleranceCents: 25,
      maxOnsetLatencyMs: 450,
    },
  },
  'controlled-vibrato': {
    1: {
      durationSec: 3,
      minSamples: 20,
      anchorFrames: 5,
      minPeakToPeakCents: 30,
      maxPeakToPeakCents: 220,
      minDirectionChanges: 3,
      centerDriftToleranceCents: 40,
    },
    2: {
      durationSec: 5,
      minSamples: 35,
      anchorFrames: 6,
      minPeakToPeakCents: 40,
      maxPeakToPeakCents: 190,
      minDirectionChanges: 5,
      centerDriftToleranceCents: 30,
    },
  },
} as const;
