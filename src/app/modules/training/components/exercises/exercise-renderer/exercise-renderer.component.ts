import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BreathFlowHoldExerciseComponent } from '../breath-flow-hold/breath-flow-hold-exercise.component';
import { SZBalanceExerciseComponent } from '../s-z-balance/s-z-balance-exercise.component';
import { DynamicWaveExerciseComponent } from '../dynamic-wave/dynamic-wave-exercise.component';
import { SteadyToneExerciseComponent } from '../steady-tone/steady-tone-exercise.component';
import { ControlledVibratoExerciseComponent } from '../controlled-vibrato/controlled-vibrato-exercise.component';
import { CleanOnsetExerciseComponent } from '../clean-onset/clean-onset-exercise.component';
import { PitchTargetExerciseComponent } from '../pitch-target/pitch-target-exercise.component';
import { PitchStepsExerciseComponent } from '../pitch-steps/pitch-steps-exercise.component';
import { PitchGlideExerciseComponent } from '../pitch-glide/pitch-glide-exercise.component';
import { VocalGlideExerciseComponent } from '../vocal-glide/vocal-glide-exercise.component';
import { StepExpansionExerciseComponent } from '../step-expansion/step-expansion-exercise.component';
import { MixCoordinationExerciseComponent } from '../mix-coordination/mix-coordination-exercise.component';
import { SingleBurstExerciseComponent } from '../single-burst/single-burst-exercise.component';
import { VolumeRiseExerciseComponent } from '../volume-rise/volume-rise-exercise.component';
import { LoudSoftAlternanceExerciseComponent } from '../loud-soft-alternance/loud-soft-alternance-exercise.component';
import { GenericExerciseComponent } from '../generic/generic-exercise.component';

type PracticeState = 'idle' | 'practicing' | 'success' | 'retry';
type SZFlowPhase = 'instructions' | 'countdown-s' | 'timing-s' | 'phase2-ready' | 'holding-z';

@Component({
  selector: 'app-exercise-renderer',
  standalone: true,
  imports: [
    CommonModule,
    BreathFlowHoldExerciseComponent,
    SZBalanceExerciseComponent,
    DynamicWaveExerciseComponent,
    SteadyToneExerciseComponent,
    ControlledVibratoExerciseComponent,
    CleanOnsetExerciseComponent,
    PitchTargetExerciseComponent,
    PitchStepsExerciseComponent,
    PitchGlideExerciseComponent,
    VocalGlideExerciseComponent,
    StepExpansionExerciseComponent,
    MixCoordinationExerciseComponent,
    SingleBurstExerciseComponent,
    VolumeRiseExerciseComponent,
    LoudSoftAlternanceExerciseComponent,
    GenericExerciseComponent,
  ],
  templateUrl: './exercise-renderer.component.html',
  styleUrl: './exercise-renderer.component.scss',
})
export class ExerciseRendererComponent {
  @Input() kind: string = 'default';
  @Input() state: PracticeState = 'idle';
  @Input() practicePrompt: string = '';
  @Input() showTargetReference: boolean = false;
  @Input() targetNote: string = '';
  @Input() targetReferenceLabel: string = '';
  @Input() remainingSeconds: number = 0;
  @Input() currentNote: string = '-';
  @Input() currentConfidence: number = 0;
  @Input() primaryCheckLabel: string = '';
  @Input() primaryOk: boolean = false;
  @Input() voiceDetected: boolean = false;
  @Input() edgeConfidenceOk: boolean = false;
  @Input() completionMet: boolean = false;
  @Input() completionLabel: string = '';
  @Input() progressPercent: number = 0;
  @Input() szRecordedDurationSec: number = 0;
  @Input() szCurrentZDurationSec: number = 0;
  @Input() szFlowPhase: SZFlowPhase = 'instructions';
  @Input() szCountdown: number = 3;

  @Output() start = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();
  @Output() finish = new EventEmitter<void>();
  @Output() playNote = new EventEmitter<void>();
  @Output() stopSZS = new EventEmitter<void>();
  @Output() startSZHold = new EventEmitter<void>();
}
