import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { VocalRangeService, RangePhase } from '../../services/vocal-range.service';
import { AudioAnalyzerService } from '../../services/audio.analyzer.service';

@Component({
  selector: 'app-vocal-range',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './vocal-range.html',
  styleUrl: './vocal-range.scss'
})
export class VocalRangeComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  protected rangeService = inject(VocalRangeService); // protected para usar en template
  private audioService = inject(AudioAnalyzerService);

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
  RangePhase = RangePhase; // Para usar en el template

  ngOnInit(): void {
    console.log('[VocalRange] Componente inicializado');
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
      alert(error.message || 'Error al iniciar el ejercicio');
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
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midi / 12) - 1;
    const noteName = noteNames[midi % 12];
    return `${noteName}${octave}`;
  }

  ngOnDestroy(): void {
    // El servicio se limpia automáticamente
  }
}
