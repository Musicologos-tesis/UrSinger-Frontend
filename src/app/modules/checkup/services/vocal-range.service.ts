import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment.development';
import { AudioPitchService } from './audio-pitch.service';
import { CalibrationService } from './calibration.service';

export enum RangePhase {
    Idle = 'idle',
    Sweep = 'sweep',           // Fase A: Barrido continuo
    ConfirmMin = 'confirm_min', // Fase B1: Confirmar mínimo
    ConfirmMax = 'confirm_max', // Fase B2: Confirmar máximo
    Complete = 'complete',
    Error = 'error'
}

export interface PitchSample {
    midi: number;
    frequency: number;
    confidence: number;
    rms: number;
    spectralCentroid: number;
    timestamp: number;
}

export interface ExtremeValidation {
    pitchOk: boolean;      // ±50 cents del target
    confidenceOk: boolean; // > 0.8
    rmsOk: boolean;        // > ruido + 6dB
    sustained: boolean;    // ≥ 1.0s
}

export interface RangeMetrics {
    sessionId: string;
    rangeSpanSemitones: number;
    rangeMinMidi: number;
    rangeMaxMidi: number;
    meanRmsDb?: number;
    rmsConsistency?: number;
    durationSeconds?: number;
    voiceType?: string;
    tessituraCenterMidi?: number;
    spectralCentroid?: number;
    dynamicRangeDb?: number;
    registerShifts?: number;
}

@Injectable({ providedIn: 'root' })
export class VocalRangeService {
    private http = inject(HttpClient);
    private pitchService: AudioPitchService = inject(AudioPitchService);
    private calibrationService = inject(CalibrationService);

    // Estado reactivo
    readonly phase$ = new BehaviorSubject<RangePhase>(RangePhase.Idle);
    readonly currentNote$ = new BehaviorSubject<string>('');
    readonly currentMidi$ = new BehaviorSubject<number>(0);
    readonly currentConfidence$ = new BehaviorSubject<number>(0);
    readonly currentRms$ = new BehaviorSubject<number>(-90);
    readonly progress$ = new BehaviorSubject<number>(0); // 0-1
    readonly errorMessage$ = new BehaviorSubject<string | null>(null);
    readonly tip$ = new BehaviorSubject<string | null>(null);
    
    // Validación de extremos
    readonly extremeValidation$ = new BehaviorSubject<ExtremeValidation>({
        pitchOk: false,
        confidenceOk: false,
        rmsOk: false,
        sustained: false
    });

    // Datos de captura
    private samples: PitchSample[] = [];
    private sweepStartTime: number = 0;
    private captureIntervalId?: number;
    
    // Extremos provisionales y confirmados
    private provisionalMin: number = 0;
    private provisionalMax: number = 0;
    private confirmedMin: number = 0;
    private confirmedMax: number = 0;
    
    // Métricas calculadas
    private calculatedMetrics?: RangeMetrics;
    
    // Validación de extremos
    private extremeValidationStartTime: number = 0;
    private extremeTarget: number = 0;
    private noiseFloorDb: number = -90;

    /**
     * Inicia el ejercicio de rango vocal
     * Fase A: Barrido continuo (20-30s)
     */
    async startSweepPhase(analyser: AnalyserNode): Promise<void> {
        try {
            // Validar que hay sessionId
            const sessionId = this.calibrationService.getSessionId();
            if (!sessionId) {
                throw new Error('No hay sessionId. Completa la calibración primero.');
            }

            // Inicializar pitch service
            await this.pitchService.initialize(analyser);

            // Obtener noise floor de la calibración (para métricas, no para filtrado)
            this.noiseFloorDb = this.calibrationService.getNoiseFloorDbfs();
            console.log('[VocalRange] Noise floor:', this.noiseFloorDb, 'dBFS (solo para métricas)');

            // Reset
            this.samples = [];
            this.sweepStartTime = performance.now();
            this.phase$.next(RangePhase.Sweep);
            this.errorMessage$.next(null);
            this.tip$.next('Recorre desde tu nota más grave hasta la más aguda');

            // Iniciar captura continua (cada 100ms)
            this.startCapture();

        } catch (error: any) {
            this.handleError(error.message || 'Error al iniciar ejercicio');
        }
    }

    /**
     * Captura continua de pitch cada 100ms
     */
    private startCapture(): void {
        this.captureIntervalId = window.setInterval(async () => {
            if (this.phase$.value === RangePhase.Idle || this.phase$.value === RangePhase.Complete) {
                this.stopCapture();
                return;
            }

            // Detectar pitch (async con CREPE)
            const { frequency, confidence, midiNote } = await this.pitchService.detectPitch();
            const rms = this.pitchService.calculateRMS();
            const spectralCentroid = this.pitchService.calculateSpectralCentroid();

            // Actualizar UI en tiempo real
            if (confidence > 0.5) {
                const noteName = this.pitchService.midiToNoteName(midiNote);
                this.currentNote$.next(noteName);
                this.currentMidi$.next(midiNote);
            }
            this.currentConfidence$.next(confidence);
            this.currentRms$.next(rms);

            // Guardar sample solo si es confiable
            if (confidence > 0.8) {
                this.samples.push({
                    midi: midiNote,
                    frequency,
                    confidence,
                    rms,
                    spectralCentroid,
                    timestamp: performance.now()
                });
            }

            // Actualizar progreso en fase de barrido
            if (this.phase$.value === RangePhase.Sweep) {
                const elapsed = (performance.now() - this.sweepStartTime) / 1000;
                const targetDuration = 12; // 12 segundos (reducido de 25)
                const progress = elapsed / targetDuration;
                this.progress$.next(Math.min(1, progress));
                
                // Auto-completar cuando llegue al 100%
                if (progress >= 1.0) {
                    this.completeSweepPhase();
                }
            }

            // Validación de extremos en fases de confirmación
            if (this.phase$.value === RangePhase.ConfirmMin || this.phase$.value === RangePhase.ConfirmMax) {
                this.validateExtreme(midiNote, confidence, rms);
            }

        }, 100); // 100ms
    }

    /**
     * Detiene la captura continua
     */
    private stopCapture(): void {
        if (this.captureIntervalId) {
            clearInterval(this.captureIntervalId);
            this.captureIntervalId = undefined;
        }
    }

    /**
     * Finaliza la fase de barrido y calcula extremos provisionales
     */
    completeSweepPhase(): void {
        if (this.phase$.value !== RangePhase.Sweep) return;

        if (this.samples.length < 50) {
            this.handleError('No hay suficientes datos. Intenta nuevamente cantando de forma continua.');
            return;
        }

        // Suavizar serie de pitch (ventana móvil de 5)
        const smoothedPitches = this.movingAverage(
            this.samples.map(s => s.midi),
            5
        );

        // Calcular min/max con trimming (descartar 2.5% extremos)
        const sorted = [...smoothedPitches].sort((a, b) => a - b);
        const trimPercent = 0.025;
        const trimCount = Math.floor(sorted.length * trimPercent);
        const trimmedData = sorted.slice(trimCount, sorted.length - trimCount);

        this.provisionalMin = trimmedData[0];
        this.provisionalMax = trimmedData[trimmedData.length - 1];

        this.log('sweep_complete', {
            samples: this.samples.length,
            provisionalMin: this.provisionalMin,
            provisionalMax: this.provisionalMax
        });

        // Transición a confirmación de mínimo
        this.startConfirmMinPhase();
    }

    /**
     * Fase B1: Confirmar nota mínima
     */
    private startConfirmMinPhase(): void {
        this.phase$.next(RangePhase.ConfirmMin);
        this.extremeTarget = this.provisionalMin;
        this.extremeValidationStartTime = 0;
        this.progress$.next(0);
        
        const noteName = this.pitchService.midiToNoteName(this.provisionalMin);
        this.tip$.next(`Canta y sostén la nota ${noteName} (tu mínimo)`);
        
        this.resetExtremeValidation();
    }

    /**
     * Fase B2: Confirmar nota máxima
     */
    startConfirmMaxPhase(): void {
        if (this.phase$.value !== RangePhase.ConfirmMin) return;

        this.confirmedMin = this.extremeTarget; // Guardar mínimo confirmado
        this.phase$.next(RangePhase.ConfirmMax);
        this.extremeTarget = this.provisionalMax;
        this.extremeValidationStartTime = 0;
        this.progress$.next(0);
        
        const noteName = this.pitchService.midiToNoteName(this.provisionalMax);
        this.tip$.next(`Canta y sostén la nota ${noteName} (tu máximo)`);
        
        this.resetExtremeValidation();
    }

    /**
     * Valida que el extremo esté sostenido correctamente
     */
    private validateExtreme(midi: number, confidence: number, rms: number): void {
        const centsFromTarget = (midi - this.extremeTarget) * 100;
        
        // Check 1: Pitch dentro de ±50 cents
        const pitchOk = Math.abs(centsFromTarget) <= 50;
        
        // Check 2: Confianza > 0.8
        const confidenceOk = confidence > 0.8;
        
        // Check 3: RMS > ruido + 6dB
        const rmsOk = rms > (this.noiseFloorDb + 6);
        
        // Actualizar estado de checks
        const currentValidation = this.extremeValidation$.value;
        this.extremeValidation$.next({
            ...currentValidation,
            pitchOk,
            confidenceOk,
            rmsOk
        });

        // Si los 3 checks están ok, iniciar timer
        if (pitchOk && confidenceOk && rmsOk) {
            if (this.extremeValidationStartTime === 0) {
                this.extremeValidationStartTime = performance.now();
            }

            const elapsed = (performance.now() - this.extremeValidationStartTime) / 1000;
            const requiredDuration = 1.0; // 1 segundo sostenido
            this.progress$.next(Math.min(1, elapsed / requiredDuration));

            // Check 4: Sostenido ≥ 1.0s
            if (elapsed >= requiredDuration) {
                this.extremeValidation$.next({
                    pitchOk: true,
                    confidenceOk: true,
                    rmsOk: true,
                    sustained: true
                });
            }
        } else {
            // Reset timer si se pierde algún check
            this.extremeValidationStartTime = 0;
            this.progress$.next(0);
            this.extremeValidation$.next({
                pitchOk,
                confidenceOk,
                rmsOk,
                sustained: false
            });
        }
    }

    /**
     * Confirma el extremo actual y avanza
     */
    confirmCurrentExtreme(): void {
        const validation = this.extremeValidation$.value;
        
        if (!validation.sustained) {
            this.tip$.next('Debes sostener la nota al menos 1 segundo con todos los checks en verde');
            return;
        }

        if (this.phase$.value === RangePhase.ConfirmMin) {
            this.startConfirmMaxPhase();
        } else if (this.phase$.value === RangePhase.ConfirmMax) {
            this.confirmedMax = this.extremeTarget;
            this.completeExercise();
        }
    }

    /**
     * Reinicia los checks de validación
     */
    private resetExtremeValidation(): void {
        this.extremeValidation$.next({
            pitchOk: false,
            confidenceOk: false,
            rmsOk: false,
            sustained: false
        });
    }

    /**
     * Completa el ejercicio, calcula métricas y envía al backend
     */
    private async completeExercise(): Promise<void> {
        this.stopCapture();
        this.phase$.next(RangePhase.Complete);
        this.tip$.next('Calculando métricas...');

        try {
            // Calcular todas las métricas
            this.calculatedMetrics = this.calculateMetrics();

            // Enviar al backend
            await this.submitMetrics(this.calculatedMetrics);

            this.tip$.next('¡Ejercicio completado exitosamente!');
            this.log('exercise_complete', this.calculatedMetrics);

        } catch (error: any) {
            this.handleError('Error al enviar métricas: ' + error.message);
        }
    }

    /**
     * Calcula todas las métricas del ejercicio
     */
    private calculateMetrics(): RangeMetrics {
        const sessionId = this.calibrationService.getSessionId()!;
        const duration = (performance.now() - this.sweepStartTime) / 1000;

        // Básicas
        const rangeSpanSemitones = this.confirmedMax - this.confirmedMin;

        // Métricas de RMS
        const rmsValues = this.samples.map(s => s.rms);
        const meanRmsDb = this.calculateMean(rmsValues);
        const rmsConsistency = this.calculateConsistency(rmsValues);

        // Tessitura (mediana de los pitches del barrido)
        const pitches = this.samples.map(s => s.midi);
        const tessituraCenterMidi = this.calculateMedian(pitches);

        // Spectral centroid promedio
        const centroids = this.samples.map(s => s.spectralCentroid);
        const spectralCentroid = this.calculateMean(centroids);

        // Dynamic range
        const dynamicRangeDb = Math.max(...rmsValues) - Math.min(...rmsValues);

        // Register shifts (saltos > 3 semitonos en serie suavizada)
        const smoothedPitches = this.movingAverage(pitches, 5);
        const registerShifts = this.detectRegisterShifts(smoothedPitches);

        // Voice type (clasificación)
        const voiceType = this.calculateVoiceType(tessituraCenterMidi);

        return {
            sessionId,
            rangeSpanSemitones,
            rangeMinMidi: this.confirmedMin,
            rangeMaxMidi: this.confirmedMax,
            meanRmsDb,
            rmsConsistency,
            durationSeconds: duration,
            voiceType,
            tessituraCenterMidi,
            spectralCentroid,
            dynamicRangeDb,
            registerShifts
        };
    }

    /**
     * Envía las métricas al backend
     */
    private async submitMetrics(metrics: RangeMetrics): Promise<void> {
        const response = await firstValueFrom(
            this.http.post<any>(
                environment.API_BASE_URL + '/metrics/range',
                metrics
            )
        );

        this.log('metrics_sent', { exerciseType: response.exerciseType });
    }

    // === FUNCIONES DE CÁLCULO ===

    private movingAverage(data: number[], windowSize: number): number[] {
        const result: number[] = [];
        const halfWindow = Math.floor(windowSize / 2);

        for (let i = 0; i < data.length; i++) {
            const start = Math.max(0, i - halfWindow);
            const end = Math.min(data.length, i + halfWindow + 1);
            const window = data.slice(start, end);
            result.push(this.calculateMean(window));
        }

        return result;
    }

    private calculateMean(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    private calculateMedian(values: number[]): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    private calculateConsistency(values: number[]): number {
        if (values.length === 0) return 0;
        const mean = this.calculateMean(values);
        const variance = values.reduce((sum, val) =>
            sum + Math.pow(val - mean, 2), 0
        ) / values.length;
        const stdDev = Math.sqrt(variance);
        return 1 - (stdDev / Math.abs(mean));
    }

    private detectRegisterShifts(smoothedPitches: number[]): number {
        let shifts = 0;
        const threshold = 3; // Semitonos

        for (let i = 1; i < smoothedPitches.length; i++) {
            const jump = Math.abs(smoothedPitches[i] - smoothedPitches[i - 1]);
            if (jump > threshold) {
                shifts++;
            }
        }

        return shifts;
    }

    private calculateVoiceType(avgMidi: number): string {
        // Clasificación estándar
        if (avgMidi < 55) return 'bass';       // < G3
        if (avgMidi < 60) return 'tenor';      // < C4
        if (avgMidi < 65) return 'alto';       // < F4
        return 'soprano';                      // >= F4
    }

    // === CONTROL Y ESTADO ===

    /**
     * Permite al usuario reintentar desde un punto específico
     */
    retryFrom(phase: 'sweep' | 'min' | 'max'): void {
        this.stopCapture();
        this.samples = [];
        this.resetExtremeValidation();
        this.errorMessage$.next(null);

        if (phase === 'sweep') {
            this.sweepStartTime = performance.now();
            this.phase$.next(RangePhase.Sweep);
            this.startCapture();
        } else if (phase === 'min') {
            this.startConfirmMinPhase();
        } else if (phase === 'max') {
            this.startConfirmMaxPhase();
        }
    }

    /**
     * Reinicia completamente el ejercicio
     */
    reset(): void {
        this.stopCapture();
        this.phase$.next(RangePhase.Idle);
        this.currentNote$.next('');
        this.currentMidi$.next(0);
        this.currentConfidence$.next(0);
        this.currentRms$.next(-90);
        this.progress$.next(0);
        this.errorMessage$.next(null);
        this.tip$.next(null);
        this.samples = [];
        this.provisionalMin = 0;
        this.provisionalMax = 0;
        this.confirmedMin = 0;
        this.confirmedMax = 0;
        this.calculatedMetrics = undefined;
        this.resetExtremeValidation();
    }

    /**
     * Obtiene las métricas calculadas (útil para mostrar en UI)
     */
    getCalculatedMetrics(): RangeMetrics | undefined {
        return this.calculatedMetrics;
    }

    private handleError(message: string): void {
        this.stopCapture();
        this.phase$.next(RangePhase.Error);
        this.errorMessage$.next(message);
    }

    private log(event: string, data?: any): void {
        if (!environment.production) {
            console.log('[vocal-range]', { event, ...data });
        }
    }

    ngOnDestroy(): void {
        this.stopCapture();
        this.pitchService.destroy();
    }
}
