import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GenericExerciseComponent } from '../generic/generic-exercise.component';

type PracticeState = 'idle' | 'practicing' | 'success' | 'retry';

@Component({
  selector: 'app-single-burst-exercise',
  standalone: true,
  imports: [CommonModule, GenericExerciseComponent],
  templateUrl: './single-burst-exercise.component.html',
  styleUrl: './single-burst-exercise.component.scss',
})
export class SingleBurstExerciseComponent {
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
