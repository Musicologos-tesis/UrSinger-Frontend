import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CalibrationService, CalibState, ValidationStatus } from '../../services/calibration.service';
import { AudioAnalyzerService } from '../../services/audio.analyzer.service';
import { StepperComponent } from '../../../../shared/components/stepper/stepper.component';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';

@Component({
  selector: 'app-calibration',
  imports: [StepperComponent, AuthHeaderComponent],
  templateUrl: './calibration.html',
  styleUrl: './calibration.scss',
})
export class CalibrationComponent implements OnDestroy {
  private router = inject(Router);
  private cal = inject(CalibrationService);
  private audio = inject(AudioAnalyzerService);

  CalibState = CalibState;
  ValidationStatus = ValidationStatus;
  
  state = signal<CalibState>(CalibState.Idle);
  progress = signal(0);
  errorMessage = signal<string | null>(null);
  tip = signal<string | null>(null);
  
  noiseStatus = signal<ValidationStatus>(ValidationStatus.Pending);
  inputStatus = signal<ValidationStatus>(ValidationStatus.Pending);
  noiseMessage = signal<string>('');
  inputMessage = signal<string>('');

  constructor() {
    this.cal.state$.subscribe(s => this.state.set(s));
    this.cal.progress$.subscribe(p => this.progress.set(p));
    this.cal.errorMessage$.subscribe(err => this.errorMessage.set(err));
    this.cal.tip$.subscribe(t => this.tip.set(t));
    
    this.cal.noiseStatus$.subscribe(status => this.noiseStatus.set(status));
    this.cal.inputStatus$.subscribe(status => this.inputStatus.set(status));
    this.cal.noiseMessage$.subscribe(msg => this.noiseMessage.set(msg));
    this.cal.inputMessage$.subscribe(msg => this.inputMessage.set(msg));
  }

  async onCalibrate() {
    // Si ya está calibrado, navegar a vocal-range
    if (this.state() === CalibState.Done) {
      console.log('[Calibration] Estado Done, navegando a vocal-range');
      await this.router.navigate(['/checkup/vocal-range']);
      return;
    }

    if (this.state() === CalibState.Error) {
      this.cal.reset();
      return;
    }

    if (this.state() !== CalibState.Idle) {
      return;
    }

    try {
      const ctx = (this.audio as any).ctx;
      if (ctx && ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Iniciar calibración - fase de ruido
      await this.cal.startCalibration();
      
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al iniciar calibración');
      this.cal.reset();
    }
  }
  
  onContinueToInput() {
    // Confirmar y enviar room_check al backend antes de continuar
    this.cal.confirmNoiseCheck();
    // Iniciar fase de nivel de entrada
    this.cal.startInputMeasurement();
  }
  
  async onConfirmInput() {
    // Confirmar o reintentar según validación
    await this.cal.confirmInputAndFinish();
  }
  
  onRetry() {
    this.cal.reset();
  }
  
  onContinueToVocalRange() {
    console.log('[Calibration] Navegando a /checkup/vocal-range');
    this.router.navigate(['/checkup/vocal-range']).then(success => {
      console.log('[Calibration] Navegación exitosa:', success);
    }).catch(error => {
      console.error('[Calibration] Error en navegación:', error);
    });
  }
  
  canConfirmNoise(): boolean {
    return this.state() === CalibState.NoiseMeasuring && 
           this.noiseStatus() === ValidationStatus.Valid;
  }
  
  isInputComplete(): boolean {
    // El input está completo cuando progress = 1 (terminó el contador de 5s)
    return this.state() === CalibState.InputMeasuring && 
           this.progress() >= 1;
  }
  
  shouldShowNoiseRecommendation(): boolean {
    return this.state() === CalibState.NoiseMeasuring &&
           this.noiseStatus() === ValidationStatus.Invalid;
  }
  
  shouldShowInputRecommendation(): boolean {
    return this.state() === CalibState.InputMeasuring &&
           this.progress() >= 1 &&
           this.inputStatus() === ValidationStatus.Invalid;
  }

  ngOnDestroy() {
    this.audio.stop();
    this.cal.reset();
  }
}
