import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GenericExerciseComponent } from '../generic/generic-exercise.component';

type PracticeState = 'idle' | 'practicing' | 'success' | 'retry';
type SZFlowPhase = 'instructions' | 'countdown-s' | 'timing-s' | 'phase2-ready' | 'holding-z';

@Component({
  selector: 'app-s-z-balance-exercise',
  standalone: true,
  imports: [CommonModule, GenericExerciseComponent],
  templateUrl: './s-z-balance-exercise.component.html',
  styleUrl: './s-z-balance-exercise.component.scss',
})
export class SZBalanceExerciseComponent {
  @Input() state: PracticeState = 'idle';
  @Input() targetNote: string = '';
  @Input() practicePrompt: string = '';
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
  @Input() recordedDurationSec: number = 0;
  @Input() currentZDurationSec: number = 0;
  @Input() szFlowPhase: SZFlowPhase = 'instructions';
  @Input() szCountdown: number = 3;

  @Output() start = new EventEmitter<void>();
  @Output() stopSZS = new EventEmitter<void>();
  @Output() startSZHold = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();
  @Output() finish = new EventEmitter<void>();
  @Output() playNote = new EventEmitter<void>();

  get hasRecordedS(): boolean {
    return this.recordedDurationSec > 0.1;
  }
}
