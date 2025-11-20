import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AudioPitchService } from './audio-pitch.service';
import { CalibrationService } from './calibration.service';
import { MetricsService } from './metrics.service';

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
    durationSec?: number;
    voiceType?: string;
    tessituraCenterMidi?: number;
    spectralCentroid?: number;
    dynamicRangeDb?: number;
    registerShifts?: number;
}

export interface MetricsData {
  meanRmsDb: number | null;
  rmsConsistency: number | null;
  dynamicRangeDb: number | null;
  durationSec: number | null;

  precisionCents: number | null;
  stabilityCents: number | null;

  rangeMinMidi: number | null;
  rangeMaxMidi: number | null;
  rangeSpanSemitones: number | null;

  vibratoRateHz: number | null;
  vibratoDepthCents: number | null;

  attackLatencyMs: number | null;
}

export interface ExerciseMetricsPayload {
  sessionId: string;
  exerciseId: string;
  attemptNumber: number;
  metricsData: MetricsData;
}

@Injectable({ providedIn: 'root' })
export class VocalRangeService {
    private pitchService: AudioPitchService = inject(AudioPitchService);
    private calibrationService = inject(CalibrationService);
    private metricsService = inject(MetricsService);

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
    
    // Muestras de confirmaciones (para calcular precisionCents y attackLatencyMs)
    private confirmationSamples: PitchSample[] = [];
    private confirmationMetrics: {
        precisionCents: number[];
        attackLatencyMs: number[];
    } = {
        precisionCents: [],
        attackLatencyMs: []
    };
    
    // Métricas calculadas
    private calculatedMetrics?: RangeMetrics;
    
    // Validación de extremos
    private extremeValidationStartTime: number = 0;
    private extremePhaseStartTime: number = 0; // Inicio de la fase completa (10s timeout)
    private extremeTarget: number = 0;
    private noiseFloorDb: number = -90;
    private extremeAttempts: number = 0; // Contador de intentos de ajuste
    
    // Continuidad de barrido (para evitar aceptar picos agudos aislados)
    private highestMidiSoFar: number = 0; // Nota más aguda detectada hasta ahora
    private readonly MAX_JUMP_SEMITONES = 5; // Salto máximo permitido (5 semitonos = 4ta justa)
    
    // Filtro de estabilidad temporal (para distinguir picos aislados de notas sostenidas)
    private lastAcceptedMidi: number = 0;
    private lastAcceptedCount: number = 0;
    private readonly MIN_REPETITIONS = 3; // Una nota debe repetirse 3 veces (300ms) para ser válida
    
    // Rango de frecuencias de voz humana (para filtrar ruidos externos)
    private readonly HUMAN_VOICE_MIN_HZ = 80;   // E2 (graves masculinos extremos)
    private readonly HUMAN_VOICE_MAX_HZ = 880;  // A5 (agudas femeninas típicas) - Reducido de 1100

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

            // Obtener métricas de calibración y calibrar CREPE
            const noiseFloorDb = this.calibrationService.getNoiseFloorDbfs();
            const avgRmsDb = this.calibrationService.getAverageRmsDb();
            
            // Auto-calibrar CREPE con las métricas del usuario
            this.pitchService.calibrateFromMetrics(avgRmsDb, noiseFloorDb);
            
            this.noiseFloorDb = noiseFloorDb;
            console.log('[VocalRange] Calibración aplicada - Noise:', noiseFloorDb.toFixed(1), 'dB, Avg RMS:', avgRmsDb.toFixed(1), 'dB');

            // Reset
            this.samples = [];
            this.highestMidiSoFar = 0; // Resetear continuidad de barrido
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

      // VALIDACIÓN: Filtros para voz humana
            // 1. RMS > ruido ambiente (eliminar ruido de fondo)
            const isAboveNoise = rms > this.noiseFloorDb;
            
            // 2. Frecuencia en rango vocal humano (80-880 Hz)
            const isHumanVoiceRange = frequency >= this.HUMAN_VOICE_MIN_HZ && frequency <= this.HUMAN_VOICE_MAX_HZ;
            
            // 3. Confidence SOLO para frecuencias extremas (muy graves o muy agudas)
            let passesConfidenceCheck = true;
            if (frequency < 100 || frequency > 700) {
                passesConfidenceCheck = confidence >= 0.15; // 15% mínimo para extremos
            }
            
            // FASE DE BARRIDO: Filtros permisivos para capturar todo el rango
            if (this.phase$.value === RangePhase.Sweep) {
                // Solo validar: ruido, rango humano y confidence para extremos
                // SIN filtros de continuidad ni estabilidad temporal
                const isVocalSignal = isAboveNoise && isHumanVoiceRange && passesConfidenceCheck;
                
                // Actualizar confidence siempre (para la barra visual)
                this.currentConfidence$.next(confidence);
                this.currentRms$.next(rms);

                // DEBUG: Log cada 20 capturas
                if (Math.random() < 0.05) {
                    console.log('[VocalRange] Barrido:', {
                        midi: midiNote,
                        freq: frequency.toFixed(1) + ' Hz',
                        conf: (confidence * 100).toFixed(1) + '%',
                        rms: rms.toFixed(1) + ' dB',
                        filters: {
                            aboveNoise: isAboveNoise,
                            inRange: isHumanVoiceRange,
                            confCheck: passesConfidenceCheck
                        },
                        FINAL: isVocalSignal,
                        samples: this.samples.length
                    });
                }

                // Capturar si pasa los filtros básicos
                if (isVocalSignal && frequency > 0 && midiNote > 0) {
                    const noteName = this.pitchService.midiToNoteName(midiNote);
                    this.currentNote$.next(noteName);
                    this.currentMidi$.next(midiNote);
                    
                    this.samples.push({
                        midi: midiNote,
                        frequency,
                        confidence,
                        rms,
                        spectralCentroid,
                        timestamp: performance.now()
                    });
                } else {
                    this.currentNote$.next('-');
                    this.currentMidi$.next(0);
                }
            }
            // FASE DE CONFIRMACIÓN: Filtros estrictos (continuidad + estabilidad temporal)
            else if (this.phase$.value === RangePhase.ConfirmMin || this.phase$.value === RangePhase.ConfirmMax) {
                // 4. Continuidad de barrido: evitar picos agudos aislados
                let isContinuousSweep = true;
                if (this.highestMidiSoFar > 0 && midiNote > 0) {
                    const jump = midiNote - this.highestMidiSoFar;
                    if (jump > this.MAX_JUMP_SEMITONES) {
                        isContinuousSweep = false;
                    }
                }
                if (this.highestMidiSoFar === 0 || midiNote <= this.highestMidiSoFar) {
                    isContinuousSweep = true;
                }
                
                // 5. Estabilidad temporal: una nota debe repetirse 3 veces seguidas
                let isStableNote = false;
                if (midiNote > 0) {
                    if (Math.abs(midiNote - this.lastAcceptedMidi) <= 1) {
                        this.lastAcceptedCount++;
                    } else {
                        this.lastAcceptedMidi = midiNote;
                        this.lastAcceptedCount = 1;
                    }
                    isStableNote = this.lastAcceptedCount >= this.MIN_REPETITIONS;
                }
                
                const isVocalSignal = isAboveNoise && isHumanVoiceRange && passesConfidenceCheck && isContinuousSweep && isStableNote;
                
                this.currentConfidence$.next(confidence);
                this.currentRms$.next(rms);

                // DEBUG: Log confirmaciones
                if (Math.random() < 0.05) {
                    const jump = this.highestMidiSoFar > 0 ? midiNote - this.highestMidiSoFar : 0;
                    console.log('[VocalRange] Confirmación:', {
                        midi: midiNote,
                        freq: frequency.toFixed(1) + ' Hz',
                        conf: (confidence * 100).toFixed(1) + '%',
                        rms: rms.toFixed(1) + ' dB',
                        filters: {
                            aboveNoise: isAboveNoise,
                            inRange: isHumanVoiceRange,
                            confCheck: passesConfidenceCheck,
                            continuous: isContinuousSweep,
                            stable: isStableNote,
                            reps: this.lastAcceptedCount
                        },
                        jumpSemitones: jump,
                        FINAL: isVocalSignal
                    });
                }

                if (isVocalSignal && frequency > 0 && midiNote > 0) {
                    const noteName = this.pitchService.midiToNoteName(midiNote);
                    this.currentNote$.next(noteName);
                    this.currentMidi$.next(midiNote);
                    
                    if (midiNote > this.highestMidiSoFar) {
                        this.highestMidiSoFar = midiNote;
                    }
                } else {
                    this.currentNote$.next('-');
                    this.currentMidi$.next(0);
                }
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
                this.validateExtreme(midiNote, confidence, rms, frequency, spectralCentroid);
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

        console.log('[VocalRange] Sweep completado - Samples capturados:', this.samples.length);

        // Reducido de 50 a 20 para ser más permisivo
        // 12 segundos a 100ms = 120 capturas máximas
        // 20 samples = ~17% de coverage mínimo (muy permisivo)
        if (this.samples.length < 20) {
            this.handleError(`No hay suficientes datos (${this.samples.length}/20). Intenta cantando de forma continua y un poco más fuerte.`);
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
     * Fase B1: Confirmar nota mínima con auto-ajuste
     */
    private startConfirmMinPhase(): void {
        this.phase$.next(RangePhase.ConfirmMin);
        this.extremeTarget = this.provisionalMin;
        this.extremeValidationStartTime = 0;
        this.extremePhaseStartTime = 0; // No iniciar hasta que haga clic en "Empezar"
        this.extremeAttempts = 0;
        this.extremeStarted$.next(false); // Resetear estado de inicio
        this.progress$.next(0);
        
        const noteName = this.pitchService.midiToNoteName(this.provisionalMin);
        this.tip$.next(`Presiona "Empezar" cuando estés listo para cantar ${noteName}`);
        
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
        this.extremeStarted$.next(false); // Resetear estado de inicio
        this.progress$.next(0);
        
        const noteName = this.pitchService.midiToNoteName(this.provisionalMax);
        this.tip$.next(`Presiona "Empezar" cuando estés listo para cantar ${noteName}`);
        
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
        this.tip$.next(`Canta y sostén la nota ${noteName} durante 1 segundo`);
        
        console.log('[VocalRange] Ejercicio iniciado para nota:', noteName);
    }

    /**
     * Valida que el extremo esté sostenido correctamente
     * Incluye timeout de 15s y auto-ajuste de medio tono
     * CAPTURA MUESTRAS para calcular precisionCents y attackLatencyMs
     */
    private validateExtreme(midi: number, confidence: number, rms: number, frequency: number, spectralCentroid: number): void {
        // No validar si el ejercicio no ha empezado
        if (!this.extremeStarted$.value) return;
        
        // TIMEOUT: Verificar si han pasado 15 segundos sin completar
        const phaseElapsed = (performance.now() - this.extremePhaseStartTime) / 1000;
        
        if (phaseElapsed >= 15.0 && !this.extremeValidation$.value.sustained) {
            // No logró completar en 15s → Auto-ajustar
            this.adjustExtremeTarget();
            return; // Salir y reintentar con nueva nota
        }
        
        const centsFromTarget = (midi - this.extremeTarget) * 100;
        
        // Check 1: Pitch dentro de ±100 cents (1 semitono)
        const pitchOk = Math.abs(centsFromTarget) <= 100;
        
        // SIN filtros de confidence ni SNR - SOLO validar pitch
        // El ruido ya se filtró antes (isVocalSignal en captura principal)
        const confidenceOk = true; // Aceptar cualquier confidence
        const rmsOk = true; // Ya validado en captura principal
        
        // DEBUG: Log validación cada 2 segundos
        if (Math.random() < 0.05) {
            console.log('[VocalRange] Validación extremo:', {
                target: this.pitchService.midiToNoteName(this.extremeTarget),
                detected: this.pitchService.midiToNoteName(midi),
                centsOff: centsFromTarget.toFixed(1),
                pitchOk,
                confidence: (confidence * 100).toFixed(1) + '%',
                rms: rms.toFixed(1) + ' dB',
                phaseElapsed: phaseElapsed.toFixed(1) + 's / 15s'
            });
        }
        
        // Actualizar estado de checks
        const currentValidation = this.extremeValidation$.value;
        this.extremeValidation$.next({
            ...currentValidation,
            pitchOk,
            confidenceOk,
            rmsOk
        });

        // Si los 3 checks están ok, iniciar timer Y CAPTURAR MUESTRAS
        if (pitchOk && confidenceOk && rmsOk) {
            if (this.extremeValidationStartTime === 0) {
                this.extremeValidationStartTime = performance.now();
                this.confirmationSamples = []; // Resetear samples para esta confirmación
            }
            
            // CAPTURAR MUESTRA para calcular précisionCents y attackLatencyMs
            this.confirmationSamples.push({
                midi,
                frequency,
                confidence,
                rms,
                spectralCentroid,
                timestamp: performance.now()
            });

            const elapsed = (performance.now() - this.extremeValidationStartTime) / 1000;
            const requiredDuration = 1.0; // 1 segundo sostenido
            this.progress$.next(Math.min(1, elapsed / requiredDuration));

            // Check 4: Sostenido ≥ 1.0s → Calcular métricas y AUTO-AVANZAR
            if (elapsed >= requiredDuration) {
                // Calcular métricas de esta confirmación
                this.calculateConfirmationMetrics();
                
                this.extremeValidation$.next({
                    pitchOk: true,
                    confidenceOk: true,
                    rmsOk: true,
                    sustained: true
                });
                
                // AUTO-AVANZAR automáticamente cuando se complete
                setTimeout(() => this.confirmCurrentExtreme(), 500);
            }
        } else {
            // Reset timer si se pierde algún check
            this.extremeValidationStartTime = 0;
            this.confirmationSamples = []; // Limpiar muestras
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
            console.log(`[VocalRange] Auto-ajuste mínimo: ${noteName} (intento ${this.extremeAttempts})`);
        } else if (this.phase$.value === RangePhase.ConfirmMax) {
            // Máximo no alcanzado → Bajar medio tono
            this.extremeTarget -= 1;
            const noteName = this.pitchService.midiToNoteName(this.extremeTarget);
            this.tip$.next(`Nota muy aguda. Intentemos ${noteName}. Presiona "Empezar" nuevamente`);
            console.log(`[VocalRange] Auto-ajuste máximo: ${noteName} (intento ${this.extremeAttempts})`);
        }
        
        // Resetear timers y botón para nuevo intento
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
            
            // Calcular promedios de las confirmaciones
            const avgPrecisionCents = this.confirmationMetrics.precisionCents.length > 0
                ? this.confirmationMetrics.precisionCents.reduce((a, b) => a + b, 0) / this.confirmationMetrics.precisionCents.length
                : undefined;
            
            const avgAttackLatencyMs = this.confirmationMetrics.attackLatencyMs.length > 0
                ? this.confirmationMetrics.attackLatencyMs.reduce((a, b) => a + b, 0) / this.confirmationMetrics.attackLatencyMs.length
                : undefined;
            
            console.log('[VocalRange] Métricas finales de confirmaciones:', {
                precisionCents: avgPrecisionCents,
                attackLatencyMs: avgAttackLatencyMs,
                confirmaciones: this.confirmationMetrics.precisionCents.length
            });
            
            // Guardar métricas parciales en localStorage
            this.metricsService.savePartialMetrics('range', {
                rangeMinMidi: this.calculatedMetrics.rangeMinMidi,
                rangeMaxMidi: this.calculatedMetrics.rangeMaxMidi,
                rangeSpanSemitones: this.calculatedMetrics.rangeSpanSemitones,
                meanRmsDb: this.calculatedMetrics.meanRmsDb,
                rmsConsistency: this.calculatedMetrics.rmsConsistency,
                dynamicRangeDb: this.calculatedMetrics.dynamicRangeDb,
                durationSec: this.calculatedMetrics.durationSec,
                precisionCents: avgPrecisionCents, // ← Agregado
                attackLatencyMs: avgAttackLatencyMs // ← Agregado
            });
            
            console.log('[vocal-range] métricas guardadas en localStorage');

            this.tip$.next('¡Ejercicio completado exitosamente!');
            this.log('exercise_complete', this.calculatedMetrics);

        } catch (error: any) {
            this.handleError('Error al enviar métricas: ' + error.message);
        }
    }

    private buildExercisePayload(metrics: RangeMetrics): ExerciseMetricsPayload {
        const data: MetricsData = {
        // Métricas generales que este ejercicio SÍ produce
        meanRmsDb: metrics.meanRmsDb ?? null,
        rmsConsistency: metrics.rmsConsistency ?? null,
        dynamicRangeDb: metrics.dynamicRangeDb ?? null,
        durationSec: metrics.durationSec ?? null,

        // Este ejercicio de rango NO calcula estas todavía
        precisionCents: null,
        stabilityCents: null,
        attackLatencyMs: null,

        // Métricas específicas de rango
        rangeMinMidi: metrics.rangeMinMidi ?? null,
        rangeMaxMidi: metrics.rangeMaxMidi ?? null,
        rangeSpanSemitones: metrics.rangeSpanSemitones ?? null,

        // Futuro vibrato → de momento null
        vibratoRateHz: null,
        vibratoDepthCents: null,
    };

    return {
        sessionId: metrics.sessionId,
        exerciseId: 'vocal_range', // id lógico del ejercicio
        attemptNumber: 1,          // más adelante puedes parametrizarlo
        metricsData: data,
    };
}

    /**
     * Calcula métricas de una confirmación de extremo (precisionCents y attackLatencyMs)
     */
    private calculateConfirmationMetrics(): void {
        if (this.confirmationSamples.length === 0) return;
        
        const midis = this.confirmationSamples.map(s => s.midi);
        const rmsValues = this.confirmationSamples.map(s => s.rms);
        
        // precisionCents: desviación promedio del target en cents
        const targetMidi = this.extremeTarget;
        const errorsCents = midis.map(m => Math.abs((m - targetMidi) * 100));
        const precisionCents = this.calculateMean(errorsCents);
        
        // attackLatencyMs: tiempo hasta que se alcanza el target (±50 cents)
        // SIN filtro de RMS - solo validar precisión de pitch
        const attackSampleIdx = this.confirmationSamples.findIndex((sample, idx) => {
            const error = Math.abs((sample.midi - targetMidi) * 100);
            return error <= 50; // ±50 cents
        });
        
        const attackLatencyMs = attackSampleIdx >= 0
            ? this.confirmationSamples[attackSampleIdx].timestamp - this.extremePhaseStartTime
            : null;
        
        // Guardar métricas de esta confirmación
        this.confirmationMetrics.precisionCents.push(precisionCents);
        if (attackLatencyMs !== null) {
            this.confirmationMetrics.attackLatencyMs.push(attackLatencyMs);
        }
        
        console.log('[VocalRange] Métricas de confirmación:', {
            target: this.pitchService.midiToNoteName(targetMidi),
            samples: this.confirmationSamples.length,
            precisionCents: precisionCents.toFixed(2),
            attackLatencyMs: attackLatencyMs ? attackLatencyMs.toFixed(0) : 'N/A'
        });
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

        // Voice type (clasificación basada en extremos confirmados)
        const voiceType = this.calculateVoiceType(this.confirmedMin, this.confirmedMax);

        return {
            sessionId,
            rangeSpanSemitones,
            rangeMinMidi: this.confirmedMin,
            rangeMaxMidi: this.confirmedMax,
            meanRmsDb,
            rmsConsistency,
            durationSec: duration,
            voiceType,
            tessituraCenterMidi,
            spectralCentroid,
            dynamicRangeDb,
            registerShifts
        };
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
        // Coeficiente de variación invertido, acotado a [0, 1]
        const cv = Math.abs(mean) < 1e-6 ? 1 : stdDev / Math.abs(mean);
        return Math.max(0, Math.min(1, 1 - cv));
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

    /**
     * Calcula el tipo de voz basado en los extremos confirmados
     * Tesituras estándar:
     * - Bajo: E2 (40) a E4 (64)
     * - Barítono: A2 (45) a A4 (69)
     * - Tenor: C3 (48) a C5 (72)
     * - Contraalto: F3 (53) a F5 (77)
     * - Mezzosoprano: A3 (57) a A5 (81)
     * - Soprano: C4 (60) a C6 (84)
     */
    private calculateVoiceType(minMidi: number, maxMidi: number): string {
        // Calcular el centro del rango
        const centerMidi = (minMidi + maxMidi) / 2;
        
        // Clasificar según el centro y los extremos
        // Voces masculinas
        if (centerMidi < 56.5) { // Centro < A♭3
            // Distinguir entre Bajo y Barítono
            if (maxMidi < 67) return 'Bajo';        // Max < G4 → Bajo
            return 'Barítono';                       // Max >= G4 → Barítono
        }
        
        if (centerMidi < 64.5) { // Centro < E4
            return 'Tenor';                          // Tenor
        }
        
        // Voces femeninas
        if (centerMidi < 69) { // Centro < A4
            return 'Contraalto';                     // Contraalto
        }
        
        if (centerMidi < 73) { // Centro < C#5
            return 'Mezzosoprano';                   // Mezzosoprano
        }
        
        return 'Soprano';                            // Soprano
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
        this.calculatedMetrics = undefined;
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
        if (!this.extremeStarted$.value || this.extremePhaseStartTime === 0) return 15;
        const elapsed = (performance.now() - this.extremePhaseStartTime) / 1000;
        return Math.max(0, Math.ceil(15 - elapsed));
    }

    private handleError(message: string): void {
        this.stopCapture();
        this.phase$.next(RangePhase.Error);
        this.errorMessage$.next(message);
    }

    private log(event: string, data?: any): void {
        console.log('[vocal-range]', { event, ...data });
    }

    ngOnDestroy(): void {
        this.stopCapture();
        this.pitchService.destroy();
    }
}
