import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type CheckupStep = 'preparation' | 'calibration' | 'vocal-range' | 'stability' | 'results';

interface StepConfig {
  id: CheckupStep;
  label: string;
  info: string;
}

@Component({
  selector: 'app-stepper',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stepper.component.html',
  styleUrl: './stepper.component.scss'
})
export class StepperComponent {
  @Input() currentStep: CheckupStep = 'preparation';

  steps: StepConfig[] = [
    { id: 'preparation', label: 'Preparación', info: 'Verificaremos que tu micrófono esté activo.' },
    { id: 'calibration', label: 'Calibración', info: 'Analizaremos tu entorno para asegurar condiciones óptimas.' },
    { id: 'vocal-range', label: 'Rango', info: 'Probaremos el rango mínimo y máximo de tu voz.' },
    { id: 'stability', label: 'Estabilidad', info: 'Probaremos qué tan estable es tu voz.' },
    { id: 'results', label: 'Resultados', info: 'Conocerás tu mejor plan de entrenamiento.' }
  ];

  isActive(step: CheckupStep): boolean {
    return this.currentStep === step;
  }
}
