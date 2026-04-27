import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-live-indicators',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './live-indicators.component.html',
  styleUrl: './live-indicators.component.scss',
})
export class LiveIndicatorsComponent {
  @Input() currentNote: string = '-';
  @Input() currentConfidence: number = 0;
}
