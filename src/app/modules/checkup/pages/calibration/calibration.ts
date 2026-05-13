import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CalibrationService, CalibState, ValidationStatus } from '../../services/calibration.service';
import { AudioAnalyzerService } from '../../services/audio.analyzer.service';
import { AuthService } from '../../../../services/auth.service';
import { StepperComponent } from '../../../../shared/components/stepper/stepper.component';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';
import { FlashcardComponent } from '../../../../shared/components/flashcard/flashcard.component';

@Component({
  selector: 'app-calibration',
  imports: [StepperComponent, AuthHeaderComponent, FlashcardComponent],
  templateUrl: './calibration.html',
  styleUrl: './calibration.scss',
})
export class CalibrationComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private cal = inject(CalibrationService);
  private audio = inject(AudioAnalyzerService);
  private authService = inject(AuthService);

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
  hasActivePlan = signal(false);
  isNavigating = signal(false);

  async ngOnInit(): Promise<void> {
    const profileId = localStorage.getItem('profile_id');
    if (profileId) {
      this.hasActivePlan.set(await this.authService.checkActiveTrainingPlan(profileId));
    }
  }

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
  
  async onContinueToInput() {
    this.isNavigating.set(true);
    this.cal.confirmNoiseCheck();
    try {
      await this.cal.startInputMeasurement();
    } finally {
      this.isNavigating.set(false);
    }
  }
  
  async onConfirmInput() {
    // Si ya está validado, al confirmar debe continuar directo al siguiente paso
    const shouldContinueToRange = this.inputStatus() === ValidationStatus.Valid;

    // Confirmar o reintentar según validación
    await this.cal.confirmInputAndFinish();

    if (shouldContinueToRange && this.state() === CalibState.Done) {
      this.onContinueToVocalRange();
    }
  }
  
  onRetryInput() {
    this.cal.retryInputMeasurement();
  }

  onRetry() {
    this.cal.reset();
  }
  
  onContinueToVocalRange() {
    this.isNavigating.set(true);
    console.log('[Calibration] Navegando a /checkup/vocal-range');
    this.router.navigate(['/checkup/vocal-range']).then(success => {
      console.log('[Calibration] Navegación exitosa:', success);
    }).catch(error => {
      console.error('[Calibration] Error en navegación:', error);
      this.isNavigating.set(false);
    });
  }
  
  canConfirmNoise(): boolean {
      return this.state() === CalibState.NoiseMeasuring && 
        this.progress() >= 1;
  }
  
  isInputComplete(): boolean {
    // El input está completo cuando progress = 1 (terminó el contador de 15s)
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

  calibrationErrorTitle(): string {
    const error = (this.errorMessage() || '').toLowerCase();
    if (error.includes('activado antes de calibrar') || error.includes('vuelve a la página de preparación')) {
      return 'Primero activa el micrófono';
    }

    return 'No se pudo completar la calibración';
  }

  calibrationErrorMessage(): string {
    const error = this.errorMessage() || 'Por favor, reintenta.';
    if (error.toLowerCase().includes('activado antes de calibrar')) {
      return 'Actívalo en Preparación y vuelve a intentar la calibración.';
    }

    return error;
  }

  goToTraining(): void {
    this.router.navigate(['/training/dashboard']);
  }

  reloadCheckup(): void {
    this.router.navigate(['/checkup/preparation']);
  }

  goToProfile(): void {
    this.router.navigate(['/profile']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }

  ngOnDestroy() {
    this.audio.stop();
    this.cal.reset();
  }
}
