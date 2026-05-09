import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AudioPitchService } from './audio-pitch.service';
import { CalibrationService } from './calibration.service';
import { MetricsService } from './metrics.service';
import { VoiceDetectionService } from '../../../services/voice-detection.service';

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
    confidence: number;
    rms: number;
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
    durationSec?: number;
    dynamicRangeDb?: number;
}


@Injectable({ providedIn: 'root' })
export class VocalRangeService {
        private readonly CAPTURE_INTERVAL_MS = 100;
        private readonly SWEEP_DURATION_SEC = 12;
        private readonly MIN_SWEEP_SAMPLES = 20;
        private readonly EXTREME_TIMEOUT_SEC = 15;

    private pitchService: AudioPitchService = inject(AudioPitchService);
    private calibrationService = inject(CalibrationService);
    private metricsService = inject(MetricsService);
    private voiceDetection = inject(VoiceDetectionService);

    // Estado reactivo
    readonly phase$ = new BehaviorSubject<RangePhase>(RangePhase.Idle);
    readonly currentNote$ = new BehaviorSubject<string>('-');
    readonly currentMidi$ = new BehaviorSubject<number>(0);
    readonly currentConfidence$ = new BehaviorSubject<number>(0);
    readonly currentRms$ = new BehaviorSubject<number>(-90);
    readonly progress$ = new BehaviorSubject<number>(0); // 0-1
    readonly errorMessage$ = new BehaviorSubject<string | null>(null);
    readonly tip$ = new BehaviorSubject<string | null>(null);
    
    // Estado del ejercicio de extremos
    readonly extremeStarted$ = new BehaviorSubject<boolean>(false); // Si ya hizo clic en "Empezar"
    
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
    
    // Muestras de confirmaciones (para calcular precisionCents y calibración)
    private confirmationSamples: PitchSample[] = [];
    private confirmationMetrics: { precisionCents: number[] } = { precisionCents: [] };

    // Métricas calculadas
    private calculatedMetrics?: RangeMetrics;
    
    // Validación de extremos
    private extremeValidationStartTime: number = 0;
    private extremePhaseStartTime: number = 0; // Inicio de la fase completa (10s timeout)
    private extremeTarget: number = 0;
    private minVoiceRmsDb: number = -40;
    private extremeAttempts: number = 0; // Contador de intentos de ajuste
    private extremeDynamicSubPhase: 'soft' | 'loud' = 'soft';
    private dynamicReadings: {
        minSoft?: number;
        minLoud?: number;
        maxSoft?: number;
        maxLoud?: number;
    } = {};
    private readonly ONSET_BLOCK_FRAMES = 3; // ~300ms de ataque a ignorar
    private wasVocalSignalInConfirmation: boolean = false;
    private onsetBlockRemainingConfirmation: number = 0;



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

            // Warm-up del detector para evitar notas fantasma en el arranque
            // (primera inferencia de TF/CREPE puede ser inestable).
            await this.warmupPitchDetector();

            // Obtener métricas de calibración y calibrar CREPE
            const noiseFloorDb = this.calibrationService.getNoiseFloorDbfs();
            const avgRmsDb = this.calibrationService.getAverageRmsDb();
            const voiceProfile = this.voiceDetection.readVoiceProfile();
            
            // Auto-calibrar CREPE con las métricas del usuario
            this.pitchService.calibrateFromMetrics(avgRmsDb, noiseFloorDb);
            
            this.minVoiceRmsDb = this.voiceDetection.buildMinVoiceRmsDb(
                noiseFloorDb,
                avgRmsDb,
                voiceProfile
            );

            // Log deshabilitado: mantener solo RMS > -40 dB en barrido

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

    private async warmupPitchDetector(): Promise<void> {
        try {
            for (let i = 0; i < 2; i++) {
                await this.pitchService.detectPitch();
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } catch {
            // Si falla warm-up, continuar con el flujo normal.
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
            const isVocalSignal = this.isValidVocalSignal(frequency, confidence, midiNote, rms);
            
            // FASE DE BARRIDO: Filtros permisivos para capturar todo el rango
            if (this.phase$.value === RangePhase.Sweep) {
                // Solo validar: ruido, rango humano y confidence para extremos
                // SIN filtros de continuidad ni estabilidad temporal
                // Actualizar confidence siempre (para la barra visual)
                this.currentConfidence$.next(confidence);
                this.currentRms$.next(rms);

                if (rms > -40) {
                    console.log('[VocalRange] RMS > -40 dB:', {
                        rms: rms.toFixed(1) + ' dB',
                        midi: midiNote,
                        freq: frequency.toFixed(1) + ' Hz',
                        conf: (confidence * 100).toFixed(1) + '%'
                    });
                }

                // Capturar si pasa los filtros básicos
                if (isVocalSignal) {
                    const noteName = this.pitchService.midiToNoteName(midiNote);
                    this.currentNote$.next(noteName);
                    this.currentMidi$.next(midiNote);
                    
                    this.samples.push({
                        midi: midiNote,
                        confidence,
                        rms,
                        timestamp: performance.now()
                    });
                } else {
                    this.currentNote$.next('-');
                    this.currentMidi$.next(0);
                }
            }
            // FASE DE CONFIRMACIÓN: Filtros estrictos (continuidad + estabilidad temporal)
            else if (this.phase$.value === RangePhase.ConfirmMin || this.phase$.value === RangePhase.ConfirmMax) {
                this.currentConfidence$.next(confidence);
                this.currentRms$.next(rms);

                // Log deshabilitado: mantener solo RMS > -40 dB en barrido

                if (isVocalSignal) {
                    const noteName = this.pitchService.midiToNoteName(midiNote);
                    this.currentNote$.next(noteName);
                    this.currentMidi$.next(midiNote);
                } else {
                    this.currentNote$.next('-');
                    this.currentMidi$.next(0);
                }
            }

            // Actualizar progreso en fase de barrido
            if (this.phase$.value === RangePhase.Sweep) {
                const elapsed = (performance.now() - this.sweepStartTime) / 1000;
                const targetDuration = this.SWEEP_DURATION_SEC;
                const progress = elapsed / targetDuration;
                this.progress$.next(Math.min(1, progress));
                
                // Auto-completar cuando llegue al 100%
                if (progress >= 1.0) {
                    this.completeSweepPhase();
                }
            }

            // Validación de extremos en fases de confirmación
            if (this.phase$.value === RangePhase.ConfirmMin || this.phase$.value === RangePhase.ConfirmMax) {
                this.validateExtreme(midiNote, confidence, rms, isVocalSignal);
            }

        }, this.CAPTURE_INTERVAL_MS);
    }

    private isValidVocalSignal(frequency: number, confidence: number, midiNote: number, rms: number): boolean {
        return this.voiceDetection.isValidVocalSample(
            {
                frequency,
                confidence,
                midiNote,
                rms
            },
            { minVoiceRmsDb: this.minVoiceRmsDb }
        );
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

        // Log deshabilitado: mantener solo RMS > -40 dB en barrido

        // Reducido de 50 a 20 para ser más permisivo
        // 12 segundos a 100ms = 120 capturas máximas
        // 20 samples = ~17% de coverage mínimo (muy permisivo)
        if (this.samples.length < this.MIN_SWEEP_SAMPLES) {
            this.handleError(`No hay suficientes datos (${this.samples.length}/${this.MIN_SWEEP_SAMPLES}). Intenta cantando de forma continua y un poco más fuerte.`);
            return;
        }

        const pitches = this.samples.map(s => s.midi);
        const { minMidi, maxMidi } = this.calculateRobustExtremes(pitches);
        this.provisionalMin = minMidi;
        this.provisionalMax = maxMidi;

        this.log('sweep_complete', {
            samples: this.samples.length,
            provisionalMin: this.provisionalMin,
            provisionalMax: this.provisionalMax
        });

        // Transición a confirmación de mínimo
        this.startConfirmMinPhase();
    }

    private calculateRobustExtremes(pitches: number[]): { minMidi: number; maxMidi: number } {
        const sorted = [...pitches].sort((a, b) => a - b);
        if (sorted.length < 8) {
            return {
                minMidi: sorted[0],
                maxMidi: sorted[sorted.length - 1]
            };
        }

        // Recorta outliers aislados (notas fantasma al inicio/final del barrido).
        const trim = Math.min(3, Math.floor(sorted.length * 0.08));
        const minIndex = Math.min(trim, sorted.length - 1);
        const maxIndex = Math.max(0, sorted.length - 1 - trim);

        return {
            minMidi: sorted[minIndex],
            maxMidi: sorted[maxIndex]
        };
    }

    /**
     * Fase B1: Confirmar nota mínima con auto-ajuste
     */
    private startConfirmMinPhase(): void {
        this.phase$.next(RangePhase.ConfirmMin);
        this.extremeTarget = this.provisionalMin;
        this.extremeValidationStartTime = 0;
        this.extremePhaseStartTime = 0; // No iniciar hasta que haga clic en "Empezar"
        this.extremeAttempts = 0;
        this.extremeDynamicSubPhase = 'soft';
        this.confirmationSamples = [];
        this.wasVocalSignalInConfirmation = false;
        this.onsetBlockRemainingConfirmation = 0;
        this.extremeStarted$.next(false); // Resetear estado de inicio
        this.progress$.next(0);

        const noteName = this.pitchService.midiToNoteName(this.provisionalMin);
        this.tip$.next(`Presiona "Empezar" cuando estés listo para cantar ${noteName} suavemente`);
        
        this.resetExtremeValidation();
    }

    /**
     * Fase B2: Confirmar nota máxima con auto-ajuste
     */
    startConfirmMaxPhase(): void {
        if (this.phase$.value !== RangePhase.ConfirmMin) return;

        this.confirmedMin = this.extremeTarget; // Guardar mínimo confirmado
        this.phase$.next(RangePhase.ConfirmMax);
        this.extremeTarget = this.provisionalMax;
        this.extremeValidationStartTime = 0;
        this.extremePhaseStartTime = 0; // No iniciar hasta que haga clic en "Empezar"
        this.extremeAttempts = 0;
        this.extremeDynamicSubPhase = 'soft';
        this.confirmationSamples = [];
        this.wasVocalSignalInConfirmation = false;
        this.onsetBlockRemainingConfirmation = 0;
        this.extremeStarted$.next(false); // Resetear estado de inicio
        this.progress$.next(0);

        const noteName = this.pitchService.midiToNoteName(this.provisionalMax);
        this.tip$.next(`Presiona "Empezar" cuando estés listo para cantar ${noteName} suavemente`);
        
        this.resetExtremeValidation();
    }

    /**
     * Inicia el ejercicio de extremo (cuando el usuario hace clic en "Empezar")
     */
    startExtremeExercise(): void {
        if (this.extremeStarted$.value) return; // Ya empezó
        
        this.extremeStarted$.next(true);
        this.extremePhaseStartTime = performance.now(); // Iniciar timeout de 15s

        const noteName = this.pitchService.midiToNoteName(this.extremeTarget);
        if (this.extremeDynamicSubPhase === 'soft') {
            this.tip$.next(`Canta ${noteName} suavemente (piano) durante 1 segundo`);
        } else {
            this.tip$.next(`Ahora canta ${noteName} con toda tu potencia durante 1 segundo`);
        }
        
        // Log deshabilitado: mantener solo RMS > -40 dB en barrido
    }

    /**
     * Valida que el extremo esté sostenido correctamente
    * Incluye timeout de 15s y auto-ajuste de medio tono
    * CAPTURA MUESTRAS para calcular precisionCents
     */
    private validateExtreme(midi: number, confidence: number, rms: number, isVocalSignal: boolean): void {
        // No validar si el ejercicio no ha empezado
        if (!this.extremeStarted$.value) return;

        // TIMEOUT: Verificar si han pasado 15 segundos sin completar
        const phaseElapsed = (performance.now() - this.extremePhaseStartTime) / 1000;
        
        if (phaseElapsed >= this.EXTREME_TIMEOUT_SEC && !this.extremeValidation$.value.sustained) {
            // No logró completar en 15s → Auto-ajustar
            this.adjustExtremeTarget();
            return; // Salir y reintentar con nueva nota
        }
        
        // Colectar muestras de voz para precisionCents (bloquear frames de ataque)
        const isOnset = isVocalSignal && !this.wasVocalSignalInConfirmation;
        this.wasVocalSignalInConfirmation = isVocalSignal;
        if (isOnset) {
            this.onsetBlockRemainingConfirmation = this.ONSET_BLOCK_FRAMES;
        }
        if (isVocalSignal) {
            if (this.onsetBlockRemainingConfirmation > 0) {
                this.onsetBlockRemainingConfirmation--;
            } else {
                this.confirmationSamples.push({ midi, confidence, rms, timestamp: performance.now() });
            }
        }

        // Usar el MISMO criterio que la UI de "nota actual":
        // si no hay señal vocal válida, no debe marcar afinación como correcta.
        if (!isVocalSignal) {
            this.extremeValidationStartTime = 0;
            this.progress$.next(0);
            this.extremeValidation$.next({
                pitchOk: false,
                confidenceOk: false,
                rmsOk: false,
                sustained: false
            });
            return;
        }

        const centsFromTarget = (midi - this.extremeTarget) * 100;

        // Check 1: Pitch dentro de ±100 cents (1 semitono)
        const pitchOk = Math.abs(centsFromTarget) <= 100;
        const confidenceOk = true;
        const rmsOk = true;

        // Actualizar estado de checks
        const currentValidation = this.extremeValidation$.value;
        this.extremeValidation$.next({
            ...currentValidation,
            pitchOk,
            confidenceOk,
            rmsOk
        });

        // Si los 3 checks están ok, iniciar/avanzar timer de sostenimiento
        if (pitchOk && confidenceOk && rmsOk) {
            if (this.extremeValidationStartTime === 0) {
                this.extremeValidationStartTime = performance.now();
            }

            const elapsed = (performance.now() - this.extremeValidationStartTime) / 1000;
            const requiredDuration = 1.0; // 1 segundo sostenido
            this.progress$.next(Math.min(1, elapsed / requiredDuration));

            // Check 4: Sostenido ≥ 1.0s → calcular métricas y avanzar
            if (elapsed >= requiredDuration) {
                this.calculateConfirmationMetrics();

                this.extremeValidation$.next({
                    pitchOk: true,
                    confidenceOk: true,
                    rmsOk: true,
                    sustained: true
                });

                const meanRms = this.calculateMean(this.confirmationSamples.map(s => s.rms));

                if (this.extremeDynamicSubPhase === 'soft') {
                    // Guardar RMS suave y pedir la nota potente
                    if (this.phase$.value === RangePhase.ConfirmMin) {
                        this.dynamicReadings.minSoft = meanRms;

                        // Calibrar confianza mínima en graves
                        const confidences = this.confirmationSamples
                            .map(s => s.confidence)
                            .filter(v => Number.isFinite(v));
                        if (confidences.length > 0) {
                            const calibratedMin = Math.max(0.05, Math.min(0.3, Math.min(...confidences)));
                            this.voiceDetection.updateVoiceProfile({ minConfidenceLow: calibratedMin });
                        }
                    } else {
                        this.dynamicReadings.maxSoft = meanRms;
                    }

                    setTimeout(() => {
                        this.extremeDynamicSubPhase = 'loud';
                        this.extremeValidationStartTime = 0;
                        this.extremePhaseStartTime = 0;
                        this.confirmationSamples = [];
                        this.wasVocalSignalInConfirmation = false;
                        this.onsetBlockRemainingConfirmation = 0;
                        this.extremeStarted$.next(false);
                        this.progress$.next(0);
                        this.resetExtremeValidation();

                        const noteName = this.pitchService.midiToNoteName(this.extremeTarget);
                        this.tip$.next(`¡Bien! Ahora presiona "Empezar" para cantar ${noteName} con toda tu potencia`);
                    }, 500);
                } else {
                    // Guardar RMS potente y AUTO-AVANZAR
                    if (this.phase$.value === RangePhase.ConfirmMin) {
                        this.dynamicReadings.minLoud = meanRms;
                    } else {
                        this.dynamicReadings.maxLoud = meanRms;
                    }

                    setTimeout(() => this.confirmCurrentExtreme(), 500);
                }
            }
        } else {
            // Reset timer si se pierde el pitch
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
     * Ajusta el extremo target cuando no se logra en 15 segundos
     */
    private adjustExtremeTarget(): void {
        this.extremeAttempts++;
        
        if (this.phase$.value === RangePhase.ConfirmMin) {
            // Mínimo no alcanzado → Subir medio tono
            this.extremeTarget += 1;
            const noteName = this.pitchService.midiToNoteName(this.extremeTarget);
            this.tip$.next(`Nota muy grave. Intentemos ${noteName}. Presiona "Empezar" nuevamente`);
            // Log deshabilitado: mantener solo RMS > -40 dB en barrido
        } else if (this.phase$.value === RangePhase.ConfirmMax) {
            // Máximo no alcanzado → Bajar medio tono
            this.extremeTarget -= 1;
            const noteName = this.pitchService.midiToNoteName(this.extremeTarget);
            this.tip$.next(`Nota muy aguda. Intentemos ${noteName}. Presiona "Empezar" nuevamente`);
            // Log deshabilitado: mantener solo RMS > -40 dB en barrido
        }
        
        // Resetear timers y botón para nuevo intento
        this.extremeDynamicSubPhase = 'soft';
        this.confirmationSamples = [];
        this.wasVocalSignalInConfirmation = false;
        this.onsetBlockRemainingConfirmation = 0;
        this.extremeValidationStartTime = 0;
        this.extremePhaseStartTime = 0;
        this.extremeStarted$.next(false); // Volver a mostrar botón "Empezar"
        this.progress$.next(0);
        this.resetExtremeValidation();
        
        // Límite de seguridad: Si ajusta más de 5 veces, algo está mal
        if (this.extremeAttempts > 5) {
            this.handleError('No se pudo confirmar el extremo después de varios intentos. Por favor, reinicia el ejercicio.');
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
            
            // Precisión: promedio de confirmaciones
            const avgPrecisionCentsRaw = this.confirmationMetrics.precisionCents.length > 0
                ? this.calculateMean(this.confirmationMetrics.precisionCents)
                : undefined;
            const avgPrecisionCents = avgPrecisionCentsRaw !== undefined
                ? Math.min(avgPrecisionCentsRaw, 600) / 2
                : undefined;
            
            // Log deshabilitado: mantener solo RMS > -40 dB en barrido
            
            // Guardar métricas parciales en localStorage
            this.metricsService.savePartialMetrics('range', {
                rangeMinMidi: this.calculatedMetrics.rangeMinMidi,
                rangeMaxMidi: this.calculatedMetrics.rangeMaxMidi,
                rangeSpanSemitones: this.calculatedMetrics.rangeSpanSemitones,
                meanRmsDb: this.calculatedMetrics.meanRmsDb,
                rmsConsistency: this.calculatedMetrics.rmsConsistency,
                dynamicRangeDb: this.calculatedMetrics.dynamicRangeDb,
                precisionCents: avgPrecisionCents, // ← Agregado
                // attackLatencyMs se calcula únicamente en estabilidad
            });
            
            // Log deshabilitado: mantener solo RMS > -40 dB en barrido

            this.tip$.next('¡Ejercicio completado exitosamente!');
            this.log('exercise_complete', this.calculatedMetrics);

        } catch (error: any) {
            this.handleError('Error al enviar métricas: ' + error.message);
        }
    }


    /**
     * Calcula métricas de una confirmación de extremo (precisionCents)
     */
    private calculateConfirmationMetrics(): void {
        if (this.confirmationSamples.length === 0) return;

        const midis = this.confirmationSamples.map(s => s.midi);
        const errorsCents = midis.map(m => Math.abs((m - this.extremeTarget) * 100));
        const precisionCents = this.calculateMean(errorsCents);
        this.confirmationMetrics.precisionCents.push(precisionCents);
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

        // Dynamic range: promedio de (potente - suave) medido en mínimo y máximo
        const { minSoft, minLoud, maxSoft, maxLoud } = this.dynamicReadings;
        const readings: number[] = [];
        if (minSoft !== undefined && minLoud !== undefined) readings.push(minLoud - minSoft);
        if (maxSoft !== undefined && maxLoud !== undefined) readings.push(maxLoud - maxSoft);
        const dynamicRangeDb = readings.length > 0
            ? readings.reduce((a, b) => a + b, 0) / readings.length
            : undefined;

        return {
            sessionId,
            rangeSpanSemitones,
            rangeMinMidi: this.confirmedMin,
            rangeMaxMidi: this.confirmedMax,
            meanRmsDb,
            rmsConsistency,
            durationSec: duration,
            dynamicRangeDb
        };
    }

    // === FUNCIONES DE CÁLCULO ===

    private calculateMean(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    private calculateConsistency(values: number[]): number {
        if (values.length === 0) return 0;
        const mean = this.calculateMean(values);
        const variance = values.reduce((sum, val) =>
            sum + Math.pow(val - mean, 2), 0
        ) / values.length;
        const stdDev = Math.sqrt(variance);
        // Coeficiente de variación invertido, acotado a [0, 1]
        const cv = Math.abs(mean) < 1e-6 ? 1 : stdDev / Math.abs(mean);
        return Math.max(0, Math.min(1, 1 - cv));
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
        
        // LIMPIAR UI - Quitar notas y valores anteriores
        this.currentNote$.next('-');
        this.currentMidi$.next(0);
        this.currentConfidence$.next(0);
        this.currentRms$.next(-90);
        this.progress$.next(0);

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
        this.currentNote$.next('-');
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
        this.extremeTarget = 0;
        this.extremeValidationStartTime = 0;
        this.extremePhaseStartTime = 0;
        this.extremeAttempts = 0;
        this.extremeDynamicSubPhase = 'soft';
        this.dynamicReadings = {};
        this.wasVocalSignalInConfirmation = false;
        this.onsetBlockRemainingConfirmation = 0;
        this.extremeStarted$.next(false);
        this.calculatedMetrics = undefined;
        this.confirmationSamples = [];
        this.confirmationMetrics = { precisionCents: [] };
        this.resetExtremeValidation();
    }

    /**
     * Obtiene las métricas calculadas (útil para mostrar en UI)
     */
    getCalculatedMetrics(): RangeMetrics | undefined {
        return this.calculatedMetrics;
    }

    /**
     * Obtiene el nombre de la nota objetivo actual (para confirmación de extremos)
     */
    getTargetNoteName(): string {
        if (this.extremeTarget === 0) return '---';
        return this.pitchService.midiToNoteName(this.extremeTarget);
    }

    /**
     * Obtiene la frecuencia de la nota objetivo (para reproducción de audio)
     */
    getTargetFrequency(): number {
        if (this.extremeTarget === 0) return 0;
        return this.pitchService.midiToFrequency(this.extremeTarget);
    }

    /**
     * Obtiene el tiempo restante del timeout de 15s
     */
    getRemainingTime(): number {
        if (!this.extremeStarted$.value || this.extremePhaseStartTime === 0) return this.EXTREME_TIMEOUT_SEC;
        const elapsed = (performance.now() - this.extremePhaseStartTime) / 1000;
        return Math.max(0, Math.ceil(this.EXTREME_TIMEOUT_SEC - elapsed));
    }

    private handleError(message: string): void {
        this.stopCapture();
        this.phase$.next(RangePhase.Error);
        this.errorMessage$.next(message);
    }

    private log(event: string, data?: any): void {
        // Log deshabilitado: mantener solo RMS > -40 dB en barrido
    }

    ngOnDestroy(): void {
        this.stopCapture();
        this.pitchService.destroy();
    }
}
