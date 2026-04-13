export type ExerciseKind = 'pitch-target' | 'steady-tone' | 'pitch-steps' | 'pitch-glide' | 'breath-flow-hold' | 's-z-balance' | 'dynamic-wave';

export interface PitchTargetRules {
  targetMidi: number;
  targetFrequencyHz: number;
  toleranceCents: number;
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
}

export interface SteadyToneRules {
  toleranceCents: number;
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
  anchorFrames: number;
}

export interface PitchStepsRules {
  startMidi: number;
  endMidi: number;
  startFrequencyHz: number;
  endFrequencyHz: number;
  intervalSemitones: number;
  toleranceCents: number;
  minSamplesPerStep: number;
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
}

export interface PitchGlideRules {
  startMidi: number;
  endMidi: number;
  startFrequencyHz: number;
  endFrequencyHz: number;
  glideSpanSemitones: number;
  endToleranceCents: number;
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
}

export interface BreathFlowHoldRules {
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
  rmsStabilityToleranceDb: number;
  rmsAnchorFrames: number;
}

export interface SZBalanceRules {
  minSamples: number;
  minSamplesPerPhase: number;
  minAirRmsDb: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
  maxSPhaseConfidence: number;
}

export interface DynamicWaveRules {
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
  rmsAnchorFrames: number;
  rmsRiseMinDb: number;
  rmsReturnToleranceDb: number;
}

interface BaseExerciseDefinition {
  id: string;
  kind: ExerciseKind;
  level: number;
  durationSec: number;
}

export interface PitchTargetDefinition extends BaseExerciseDefinition {
  kind: 'pitch-target';
  rules: PitchTargetRules;
}

export interface SteadyToneDefinition extends BaseExerciseDefinition {
  kind: 'steady-tone';
  rules: SteadyToneRules;
}

export interface PitchStepsDefinition extends BaseExerciseDefinition {
  kind: 'pitch-steps';
  rules: PitchStepsRules;
}

export interface PitchGlideDefinition extends BaseExerciseDefinition {
  kind: 'pitch-glide';
  rules: PitchGlideRules;
}

export interface BreathFlowHoldDefinition extends BaseExerciseDefinition {
  kind: 'breath-flow-hold';
  rules: BreathFlowHoldRules;
}

export interface SZBalanceDefinition extends BaseExerciseDefinition {
  kind: 's-z-balance';
  rules: SZBalanceRules;
}

export interface DynamicWaveDefinition extends BaseExerciseDefinition {
  kind: 'dynamic-wave';
  rules: DynamicWaveRules;
}

export type ExerciseDefinition = PitchTargetDefinition | SteadyToneDefinition | PitchStepsDefinition | PitchGlideDefinition | BreathFlowHoldDefinition | SZBalanceDefinition | DynamicWaveDefinition;

export interface ExerciseDescriptor {
  id: string;
  exerciseName: string;
  level: number;
  targetMidi: number;
}

export interface ExerciseRuntimeState {
  anchorFrequencyHz: number | null;
  anchorFrameCount: number;
  currentStepIndex: number;
  stepValidFrames: number[];
  previousMidi: number | null;
  glidePhase: 'up' | 'down' | 'complete';
  glidePeakReached: boolean;
  glideReturnedStart: boolean;
  rmsAnchorDb: number | null;
  rmsAnchorFrameCount: number;
  szPhase: 's' | 'z' | 'complete';
  szSamplesS: number;
  szSamplesZ: number;
  dynamicPhase: 'rise' | 'fall' | 'complete';
  dynamicAnchorDb: number | null;
  dynamicAnchorFrameCount: number;
  dynamicPeakDb: number | null;
  dynamicPeakReached: boolean;
  dynamicReturned: boolean;
}

export interface VoiceFrame {
  timestamp: number;
  midiNote: number;
  frequency: number;
  confidence: number;
  rms: number;
}

export interface ExerciseFrameChecks {
  voiceDetected: boolean;
  edgeConfidenceOk: boolean;
  primaryOk: boolean;
}

export interface ExerciseFrameEvaluation {
  checks: ExerciseFrameChecks;
  isValidFrame: boolean;
}

export interface ExerciseResult {
  passed: boolean;
  validFrames: number;
  requiredFrames: number;
  completionRatio: number;
  score: number;
}
