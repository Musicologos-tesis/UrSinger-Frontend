export type ExerciseKind = 'pitch-target' | 'steady-tone' | 'pitch-steps' | 'step-expansion' | 'pitch-glide' | 'mix-coordination' | 'breath-flow-hold' | 's-z-balance' | 'dynamic-wave' | 'volume-rise' | 'loud-soft-alternance' | 'single-burst' | 'clean-onset' | 'controlled-vibrato';

export interface PitchTargetRules {
  targetMidi: number;
  targetFrequencyHz: number;
  toleranceCents: number;
  holdDurationMs: number;
  requiredRepetitions: number;
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
  noteHoldMs: number;
  requiredRepetitions: number;
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
  requiredRepetitions: number;
  endToleranceCents: number;
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
}

export interface MixCoordinationRules {
  startMidi: number;
  endMidi: number;
  startFrequencyHz: number;
  endFrequencyHz: number;
  mixCenterMidi: number;
  mixCenterFrequencyHz: number;
  glideSpanSemitones: number;
  mixWindowToleranceCents: number;
  endToleranceCents: number;
  minTransitionSamples: number;
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
}

export interface StepExpansionRules {
  sequenceMidis: number[];
  sequenceFrequenciesHz: number[];
  semitoneSpan: number;
  noteCount: number;
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

export interface BreathFlowHoldRules {
  targetMidi: number;
  targetFrequencyHz: number;
  pitchToleranceCents: number;
  minSamples: number;
  requiredHoldMs: number;
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
  targetMidi: number;
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
  toleranceSemitones: number;
  maxExtraHoldSeconds: number;
}

export interface DynamicWaveRules {
  targetMidi: number;
  pitchToleranceCents: number;
  requiredCycles: number;
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

export interface VolumeRiseRules {
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
  rmsAnchorFrames: number;
  pitchAnchorFrames: number;
  pitchToleranceCents: number;
  rmsRiseMinDb: number;
}

export interface LoudSoftAlternanceRules {
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
  rmsAnchorFrames: number;
  pitchAnchorFrames: number;
  pitchToleranceCents: number;
  loudDeltaDb: number;
  softReturnToleranceDb: number;
  requiredCycles: number;
}

export interface SingleBurstRules {
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
  rmsAnchorFrames: number;
  minAttackDeltaDb: number;
}

export interface CleanOnsetRules {
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
  maxOnsetLatencyMs: number;
}

export interface ControlledVibratoRules {
  minSamples: number;
  minVoiceRmsDb: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  edgeFrequencyLowHz: number;
  edgeFrequencyHighHz: number;
  minEdgeConfidence: number;
  anchorFrames: number;
  minPeakToPeakCents: number;
  maxPeakToPeakCents: number;
  minDirectionChanges: number;
  centerDriftToleranceCents: number;
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

export interface MixCoordinationDefinition extends BaseExerciseDefinition {
  kind: 'mix-coordination';
  rules: MixCoordinationRules;
}

export interface StepExpansionDefinition extends BaseExerciseDefinition {
  kind: 'step-expansion';
  rules: StepExpansionRules;
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

export interface VolumeRiseDefinition extends BaseExerciseDefinition {
  kind: 'volume-rise';
  rules: VolumeRiseRules;
}

export interface LoudSoftAlternanceDefinition extends BaseExerciseDefinition {
  kind: 'loud-soft-alternance';
  rules: LoudSoftAlternanceRules;
}

export interface SingleBurstDefinition extends BaseExerciseDefinition {
  kind: 'single-burst';
  rules: SingleBurstRules;
}

export interface CleanOnsetDefinition extends BaseExerciseDefinition {
  kind: 'clean-onset';
  rules: CleanOnsetRules;
}

export interface ControlledVibratoDefinition extends BaseExerciseDefinition {
  kind: 'controlled-vibrato';
  rules: ControlledVibratoRules;
}

export type ExerciseDefinition = PitchTargetDefinition | SteadyToneDefinition | PitchStepsDefinition | StepExpansionDefinition | PitchGlideDefinition | MixCoordinationDefinition | BreathFlowHoldDefinition | SZBalanceDefinition | DynamicWaveDefinition | VolumeRiseDefinition | LoudSoftAlternanceDefinition | SingleBurstDefinition | CleanOnsetDefinition | ControlledVibratoDefinition;

export interface ExerciseDescriptor {
  id: string;
  exerciseName: string;
  level: number;
  targetMidi: number;
}

export interface ExerciseRuntimeState {
  anchorFrequencyHz: number | null;
  anchorFrameCount: number;
  pitchTargetCurrentHoldMs: number;
  pitchTargetRepetitions: number;
  pitchTargetLastValidMs: number | null;
  pitchStepsCurrentHoldMs: number;
  pitchStepsRepetitions: number;
  pitchStepsLastValidMs: number | null;
  currentStepIndex: number;
  stepValidFrames: number[];
  previousMidi: number | null;
  glidePhase: 'up' | 'down' | 'complete';
  pitchGlideRepetitions: number;
  glidePeakReached: boolean;
  glideReturnedStart: boolean;
  rmsAnchorDb: number | null;
  rmsAnchorFrameCount: number;
  szPhase: 's' | 'z' | 'complete';
  szSamplesZ: number;
  szSPhaseDurationMs: number;
  szZPhaseDurationMs: number;
  szZRequiredDurationMs: number;
  szZStartMs: number | null;
  szZMaxDurationMs: number;
  szLastValidFrameMs: number | null;
  dynamicPhase: 'rise' | 'fall' | 'complete';
  dynamicAnchorDb: number | null;
  dynamicAnchorFrameCount: number;
  dynamicPeakDb: number | null;
  dynamicPeakReached: boolean;
  dynamicReturned: boolean;
  dynamicCyclesCompleted: number;
  volumeRiseAnchorDb: number | null;
  volumeRiseAnchorFrameCount: number;
  volumeRiseAnchorFrequencyHz: number | null;
  volumeRisePitchFrameCount: number;
  volumeRisePeakDb: number | null;
  volumeRisePeakReached: boolean;
  alternancePhase: 'loud' | 'soft' | 'complete';
  alternanceCyclesCompleted: number;
  alternanceAnchorDb: number | null;
  alternanceAnchorFrameCount: number;
  alternanceAnchorFrequencyHz: number | null;
  alternancePitchFrameCount: number;
  alternancePeakDb: number | null;
  singleBurstAnchorDb: number | null;
  singleBurstAnchorFrameCount: number;
  singleBurstAttackReached: boolean;
  onsetStartTimeMs: number | null;
  onsetLatencyMs: number | null;
  onsetReachedTarget: boolean;
  vibratoAnchorFrequencyHz: number | null;
  vibratoAnchorFrameCount: number;
  vibratoLastSign: -1 | 0 | 1;
  vibratoDirectionChanges: number;
  vibratoMaxCents: number | null;
  vibratoMinCents: number | null;
  mixTransitionSamples: number;
  mixTransitionReached: boolean;
  breathHoldCurrentStartMs: number | null;
  breathHoldMaxMs: number;
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
