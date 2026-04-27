import {
  ExerciseDefinition,
  ExerciseDescriptor,
  ExerciseFrameEvaluation,
  ExerciseKind,
  ExerciseResult,
  ExerciseRuntimeState,
  VoiceFrame,
} from './exercise-engine.models';

export interface ExerciseStrategy {
  kind: ExerciseKind;
  buildDefinition(exercise: ExerciseDescriptor): ExerciseDefinition;
  evaluateFrame(frame: VoiceFrame, definition: ExerciseDefinition, runtime: ExerciseRuntimeState): ExerciseFrameEvaluation;
  buildResult(validFrames: number, definition: ExerciseDefinition, runtime?: ExerciseRuntimeState): ExerciseResult;
}
