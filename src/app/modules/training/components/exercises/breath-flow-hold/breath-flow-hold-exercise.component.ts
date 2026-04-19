import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LiveIndicatorsComponent } from '../../shared/live-indicators/live-indicators.component';
import { ValidationChecksComponent } from '../../shared/validation-checks/validation-checks.component';
import { ProgressMeterComponent } from '../../shared/progress-meter/progress-meter.component';

type PracticeState = 'idle' | 'practicing' | 'success' | 'retry';

@Component({
  selector: 'app-breath-flow-hold-exercise',
  standalone: true,
  imports: [CommonModule, LiveIndicatorsComponent, ValidationChecksComponent, ProgressMeterComponent],
  templateUrl: './breath-flow-hold-exercise.component.html',
  styleUrl: './breath-flow-hold-exercise.component.scss',
})
export class BreathFlowHoldExerciseComponent {
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

  @Output() start = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();
  @Output() finish = new EventEmitter<void>();
  @Output() playNote = new EventEmitter<void>();
}
