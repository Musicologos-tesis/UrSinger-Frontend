import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

type ExerciseGroupIconKey = 'breath' | 'pitch' | 'vibrato' | 'power' | 'range' | 'default';

const GROUP_ICON_KEYS: Record<number, ExerciseGroupIconKey> = {
  1: 'breath',
  2: 'pitch',
  3: 'vibrato',
  4: 'power',
  5: 'range',
};

@Component({
  selector: 'app-exercise-group-icon',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './exercise-group-icon.component.html',
  styleUrl: './exercise-group-icon.component.scss',
})
export class ExerciseGroupIconComponent {
  @Input() groupNumber?: number | null;

  get iconKey(): ExerciseGroupIconKey {
    if (typeof this.groupNumber === 'number') {
      const key = GROUP_ICON_KEYS[this.groupNumber];
      if (key) {
        return key;
      }
    }

    return 'default';
  }
}
