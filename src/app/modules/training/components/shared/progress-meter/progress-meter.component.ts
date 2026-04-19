import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-progress-meter',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './progress-meter.component.html',
  styleUrl: './progress-meter.component.scss',
})
export class ProgressMeterComponent {
  @Input() progressPercent: number = 0;
}
