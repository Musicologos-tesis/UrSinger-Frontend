import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { VocalRangeService, RangePhase } from '../../services/vocal-range.service';
import { AudioAnalyzerService } from '../../services/audio.analyzer.service';
import { AuthService } from '../../../../services/auth.service';
import { StepperComponent } from '../../../../shared/components/stepper/stepper.component';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';
import { FlashcardComponent } from '../../../../shared/components/flashcard/flashcard.component';

@Component({
  selector: 'app-vocal-range',
  standalone: true,
  imports: [CommonModule, StepperComponent, AuthHeaderComponent, FlashcardComponent],
  templateUrl: './vocal-range.html',
  styleUrl: './vocal-range.scss'
})
export class VocalRangeComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  protected rangeService = inject(VocalRangeService); // protected para usar en template
  private audioService = inject(AudioAnalyzerService);
  private authService = inject(AuthService);

  // Signals reactivos (desde el servicio)
  phase = this.rangeService.phase$;
  currentNote = this.rangeService.currentNote$;
  currentMidi = this.rangeService.currentMidi$;
  currentConfidence = this.rangeService.currentConfidence$;
  currentRms = this.rangeService.currentRms$;
  progress = this.rangeService.progress$;
  errorMessage = this.rangeService.errorMessage$;
  tip = this.rangeService.tip$;
  extremeValidation = this.rangeService.extremeValidation$;

  // Estados locales
  isLoading = signal(false);
  hasActivePlan = signal(false);
  RangePhase = RangePhase; // Para usar en el template
  Math = Math; // Para usar Math.round en el template

  async ngOnInit(): Promise<void> {
    console.log('[VocalRange] Componente inicializado');

    // Importante: el servicio es singleton, por lo que puede conservar estado
    // de una evaluación previa (por ejemplo fase "complete"). Al entrar a la
    // pantalla de rango siempre iniciamos desde cero.
    this.rangeService.reset();

    const profileId = localStorage.getItem('profile_id');
    if (profileId) {
      this.hasActivePlan.set(await this.authService.checkActiveTrainingPlan(profileId));
    }
    // El analyser se inicializará cuando el usuario haga clic en "Comenzar Ejercicio"
  }

  /**
   * Inicia la fase de barrido continuo
   */
  async onStartSweep(): Promise<void> {
    this.isLoading.set(true);
    try {
      // Verificar si ya hay un analyser activo
      let analyser = this.audioService.getAnalyser();
      
      // Si no hay analyser, inicializar el audio
      if (!analyser) {
        console.log('[VocalRange] Inicializando micrófono...');
        await this.audioService.requestMic();
        analyser = this.audioService.getAnalyser();
        
        if (!analyser) {
          throw new Error('No se pudo inicializar el micrófono. Por favor, otorga permisos.');
        }
      }

      await this.rangeService.startSweepPhase(analyser);
    } catch (error: any) {
      console.error('Error al iniciar barrido:', error);
      this.rangeService.errorMessage$.next(error.message || 'Error al iniciar el ejercicio');
      this.rangeService.phase$.next(RangePhase.Error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Finaliza la fase de barrido y calcula extremos
   */
  onCompleteSweep(): void {
    this.rangeService.completeSweepPhase();
  }

  /**
   * Confirma el extremo actual (min o max)
   */
  onConfirmExtreme(): void {
    this.rangeService.confirmCurrentExtreme();
  }

  /**
   * Reproduce la nota objetivo como referencia
   */
  playTargetNote(): void {
    const frequency = this.rangeService.getTargetFrequency();
    if (frequency === 0) return;

    try {
      // Crear contexto de audio si no existe
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Crear oscilador (onda sinusoidal)
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      
      // Configurar volumen (fade in/out)
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.1); // Fade in
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.9); // Sostener
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 1.0);   // Fade out
      
      // Conectar y reproducir
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 1.0);
      
      // Limpiar después
      setTimeout(() => {
        oscillator.disconnect();
        gainNode.disconnect();
        audioContext.close();
      }, 1100);
      
    } catch (error) {
      console.error('[VocalRange] Error al reproducir nota:', error);
    }
  }

  /**
   * Permite reintentar desde un punto específico
   */
  onRetry(phase: 'sweep' | 'min' | 'max'): void {
    this.rangeService.retryFrom(phase);
  }

  /**
   * Finaliza el ejercicio y navega al siguiente paso
   */
  onContinue(): void {
    // TODO: Navegar al ejercicio de estabilidad
    this.router.navigate(['/checkup/stability']);
  }

  /**
   * Cancela el ejercicio y vuelve a calibración
   */
  onCancel(): void {
    this.rangeService.reset();
    this.router.navigate(['/checkup/calibration']);
  }

  /**
   * Verifica si el botón de confirmar extremo debe estar habilitado
   */
  canConfirmExtreme(): boolean {
    const validation = this.extremeValidation.value;
    return validation.pitchOk && validation.confidenceOk && validation.rmsOk && validation.sustained;
  }

  /**
   * Obtiene el color del semáforo según el estado del check
   */
  getCheckColor(isOk: boolean): string {
    return isOk ? 'green' : 'red';
  }

  /**
   * Obtiene el icono del check
   */
  getCheckIcon(isOk: boolean): string {
    return isOk ? '✓' : '✗';
  }

  /**
   * Formatea el nivel de confianza como porcentaje
   */
  formatConfidence(confidence: number): string {
    return `${Math.round(confidence * 100)}%`;
  }

  /**
   * Formatea el RMS para mostrar en UI
   */
  formatRms(rms: number): string {
    return `${rms.toFixed(1)} dB`;
  }

  /**
   * Formatea un número MIDI a nombre de nota
   */
  formatNote(midi: number): string {
    if (!midi || midi <= 0 || !isFinite(midi)) return '-';
    
    const midiInt = Math.round(midi);
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midiInt / 12) - 1;
    const noteIndex = midiInt % 12;
    const noteName = noteNames[noteIndex];
    
    if (!noteName) return '-';
    
    return `${noteName}${octave}`;
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

  ngOnDestroy(): void {
    // Limpia estado de rango al salir para evitar arrastre al reingresar.
    this.rangeService.reset();
  }
}
