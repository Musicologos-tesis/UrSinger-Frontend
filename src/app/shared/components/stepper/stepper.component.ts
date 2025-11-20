import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type CheckupStep = 'preparation' | 'calibration' | 'vocal-range' | 'stability' | 'results';

interface StepConfig {
  id: CheckupStep;
  label: string;
}

@Component({
  selector: 'app-stepper',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stepper.component.html',
  styleUrls: ['./stepper.component.scss']
})
export class StepperComponent {
  @Input() currentStep: CheckupStep = 'preparation';

  steps: StepConfig[] = [
    { id: 'preparation', label: 'Preparación' },
    { id: 'calibration', label: 'Calibración' },
    { id: 'vocal-range', label: 'Rango' },
    { id: 'stability', label: 'Estabilidad' },
    { id: 'results', label: 'Resultados' }
  ];

  isActive(step: CheckupStep): boolean {
    return this.currentStep === step;
  }
}
