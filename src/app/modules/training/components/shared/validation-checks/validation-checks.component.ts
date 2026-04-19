import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-validation-checks',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './validation-checks.component.html',
  styleUrl: './validation-checks.component.scss',
})
export class ValidationChecksComponent {
  @Input() primaryOk: boolean = false;
  @Input() voiceDetected: boolean = false;
  @Input() primaryLabel: string = '';
  @Input() completionOk: boolean = false;
  @Input() completionLabel: string = '';
}
