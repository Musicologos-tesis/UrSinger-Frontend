import { ExerciseKind } from './exercise-engine.models';

const normalizeExerciseName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\/–—-]/g, ' ')
    .toLowerCase();

const EXERCISE_NAME_KIND_BY_NORMALIZED: Record<string, ExerciseKind> = {
  'flujo de aire sostenido': 'breath-flow-hold',
  'balance del aire sin voz con voz': 's-z-balance',
  'potencia dinamica': 'dynamic-wave',
  'nota objetivo': 'pitch-target',
  'notas escalonadas': 'pitch-steps',
  'deslizamiento entre notas': 'pitch-glide',
  'nota estable': 'steady-tone',
  'vibrato controlado': 'controlled-vibrato',
  'ataque limpio de nota': 'clean-onset',
  'ataque potente de nota': 'single-burst',
  'incremento de volumen': 'volume-rise',
  'dinamismo de potencia controlado': 'loud-soft-alternance',
  'deslizamiento vocal': 'pitch-glide',
  'expansion escalonada de notas': 'step-expansion',
  'transicion de registro mixto': 'mix-coordination',
};

export const EXERCISE_NAME_KIND_PATTERNS: Array<{ pattern: RegExp; kind: ExerciseKind }> = [
  { pattern: /pitch\s*target/i, kind: 'pitch-target' },
  { pattern: /objetivo\s*de\s*(afinacion|tono|pitch)/i, kind: 'pitch-target' },
  { pattern: /nota\s*objetivo/i, kind: 'pitch-target' },
  { pattern: /steady\s*tone/i, kind: 'steady-tone' },
  { pattern: /tono\s*(estable|constante)/i, kind: 'steady-tone' },
  { pattern: /breath\s*flow\s*hold/i, kind: 'breath-flow-hold' },
  { pattern: /flujo\s*de\s*aire/i, kind: 'breath-flow-hold' },
  { pattern: /sosten(?:er|ido|imiento)?\s*(del|de)\s*aire/i, kind: 'breath-flow-hold' },
  { pattern: /dynamic\s*wave/i, kind: 'dynamic-wave' },
  { pattern: /onda\s*dinamica/i, kind: 'dynamic-wave' },
  { pattern: /volume\s*rise/i, kind: 'volume-rise' },
  { pattern: /subida\s*de\s*volumen/i, kind: 'volume-rise' },
  { pattern: /aumento\s*de\s*volumen/i, kind: 'volume-rise' },
  { pattern: /loud\s*[–-]\s*soft\s*alternance/i, kind: 'loud-soft-alternance' },
  { pattern: /alternancia\s*(de\s*)?(fuerte|suave)/i, kind: 'loud-soft-alternance' },
  { pattern: /(fuerte|suave)\s*[–-]\s*(suave|fuerte)/i, kind: 'loud-soft-alternance' },
  { pattern: /single\s*burst/i, kind: 'single-burst' },
  { pattern: /rafaga\s*unica/i, kind: 'single-burst' },
  { pattern: /ataque\s*unico/i, kind: 'single-burst' },
  { pattern: /clean\s*onset/i, kind: 'clean-onset' },
  { pattern: /(inicio|ataque)\s*limpio/i, kind: 'clean-onset' },
  { pattern: /controlled\s*vibrato/i, kind: 'controlled-vibrato' },
  { pattern: /vibrato\s*controlado/i, kind: 'controlled-vibrato' },
  { pattern: /s\s*[–-]\s*z\s*balance/i, kind: 's-z-balance' },
  { pattern: /balance\s*s\s*[–-]\s*z/i, kind: 's-z-balance' },
  { pattern: /pitch\s*steps/i, kind: 'pitch-steps' },
  { pattern: /pasos\s*(de\s*)?(afinacion|tono|tonal)/i, kind: 'pitch-steps' },
  { pattern: /escalones\s*tonales?/i, kind: 'pitch-steps' },
  { pattern: /step\s*expansion/i, kind: 'step-expansion' },
  { pattern: /expansion\s*(de\s*)?(pasos|escalas|escalonada)/i, kind: 'step-expansion' },
  { pattern: /pitch\s*glide/i, kind: 'pitch-glide' },
  { pattern: /deslizamiento\s*(de\s*)?(afinacion|tono|tonal)/i, kind: 'pitch-glide' },
  { pattern: /vocal\s*glide/i, kind: 'pitch-glide' },
  { pattern: /deslizamiento\s*vocal/i, kind: 'pitch-glide' },
  { pattern: /sirena\s*vocal/i, kind: 'pitch-glide' },
  { pattern: /glissando\s*(vocal|tonal)?/i, kind: 'pitch-glide' },
  { pattern: /mix\s*coordination/i, kind: 'mix-coordination' },
  { pattern: /coordinacion\s*(de\s*)?(mix|mixta|mezcla)/i, kind: 'mix-coordination' },
];

export const EXERCISE_ID_KIND_MAP: Partial<Record<number, ExerciseKind>> = {
  // Se completa con los IDs reales del backend cuando estén disponibles.
};

export function resolveExerciseKindFromId(exerciseId?: number | null): ExerciseKind | null {
  if (typeof exerciseId !== 'number') {
    return null;
  }

  return EXERCISE_ID_KIND_MAP[exerciseId] ?? null;
}

export function resolveExerciseKindFromName(exerciseName: string): ExerciseKind | null {
  const normalizedName = normalizeExerciseName(exerciseName);

  const exactKind = EXERCISE_NAME_KIND_BY_NORMALIZED[normalizedName];
  if (exactKind) {
    return exactKind;
  }

  for (const matcher of EXERCISE_NAME_KIND_PATTERNS) {
    if (matcher.pattern.test(normalizedName)) {
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
