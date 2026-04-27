import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment.development';
import { AudioAnalyzerService } from './audio.analyzer.service';
import { AudioPitchService } from './audio-pitch.service';
import { BehaviorSubject } from 'rxjs';
import { firstValueFrom } from 'rxjs';

export enum CalibState {
    Idle = 'idle',
    NoiseMeasuring = 'noise_measuring',
    InputMeasuring = 'input_measuring',
    Done = 'done',
    Error = 'error'
}

export enum ValidationStatus {
    Pending = 'pending',
    Valid = 'valid',
    Invalid = 'invalid'
}

interface CalibrationPayload {
    profileId: string;
    sessionId: string;
    deviceIdHash: string;
    sampleRate: number;
    noiseFloorDbfs: number;
    snrDb: number;
}

@Injectable({ providedIn: 'root' })
export class CalibrationService {
    private http = inject(HttpClient);
    private audio = inject(AudioAnalyzerService);
    private pitch = inject(AudioPitchService);
    private sessionId?: string;
    private noiseFloorDbfs: number = -90;
    private signalRmsDb: number = -30;
    
    // Thresholds fijos del frontend
    private readonly NOISE_THRESHOLD_DBFS = -40;
    private readonly RMS_MIN_DB = -35;
    private readonly RMS_MAX_DB = -10;

    readonly state$ = new BehaviorSubject<CalibState>(CalibState.Idle);
    readonly progress$ = new BehaviorSubject<number>(0);
    readonly noiseDbfs$ = new BehaviorSubject<number | null>(null);
    readonly inputRmsDb$ = new BehaviorSubject<number | null>(null);
    readonly errorMessage$ = new BehaviorSubject<string | null>(null);
    readonly tip$ = new BehaviorSubject<string | null>(null);
    readonly noiseStatus$ = new BehaviorSubject<ValidationStatus>(ValidationStatus.Pending);
    readonly inputStatus$ = new BehaviorSubject<ValidationStatus>(ValidationStatus.Pending);
    readonly noiseMessage$ = new BehaviorSubject<string>('');
    readonly inputMessage$ = new BehaviorSubject<string>('');

    private readonly MIN_PITCH_CONFIDENCE = 0.15;
    private readonly MIN_PITCH_VALID_RATE = 0.6;
    private readonly MAX_PITCH_STD_SEMITONES = 8;

    async startCalibration() {
        try {
            const analyser = this.audio.getAnalyser();
            if (!analyser) {
                throw new Error('El micrófono debe estar activado antes de calibrar. Vuelve a la página de preparación.');
            }

            this.errorMessage$.next(null);
            this.tip$.next(null);
            
            // SIEMPRE generar un nuevo sessionId único para cada calibración
            this.sessionId = this.generateSessionId();
            localStorage.setItem('ursinger.checkup.sessionId', this.sessionId);
            
            // Limpiar métricas parciales del checkup anterior (si existían)
            localStorage.removeItem('ursinger.metrics.partial');
            
            console.log('[Calibration] Nuevo sessionId generado:', this.sessionId);
            
            // Iniciar fase de medición de ruido
            this.state$.next(CalibState.NoiseMeasuring);
            this.progress$.next(0);
            this.startRoomCheck();
            
        } catch (error: any) {
            this.handleError(error.message || 'Error al iniciar calibración');
        }
    }

    private generateSessionId(): string {
        // Generar ID único: timestamp + random + contador para evitar colisiones
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 11);
        const counter = Math.floor(Math.random() * 1000);
        return `session-${timestamp}-${random}-${counter}`;
    }

    private startRoomCheck() {
        const analyser = this.audio.getAnalyser();
        if (!analyser) return;

        const durationSec = 10;
        const td = new Uint8Array(analyser.fftSize);
        const start = performance.now();
        let sumDbfs = 0;
        let frameCount = 0;

        const loop = () => {
            if (this.state$.value !== CalibState.NoiseMeasuring) return;

            const now = performance.now();
            const elapsedSec = (now - start) / 1000;
            const progress = Math.min(1, elapsedSec / durationSec);
            this.progress$.next(progress);

            analyser.getByteTimeDomainData(td);
            const { rms } = this.timeDomainRms(td);
            const dbfs = 20 * Math.log10(Math.max(rms, 1e-6));
            
            sumDbfs += dbfs;
            frameCount++;
            this.noiseDbfs$.next(dbfs);

            if (elapsedSec < durationSec) {
                requestAnimationFrame(loop);
                return;
            }

            const avgNoiseFloorDbfs = frameCount > 0 ? sumDbfs / frameCount : -90;
            this.noiseFloorDbfs = avgNoiseFloorDbfs;
            this.noiseStatus$.next(ValidationStatus.Valid);
            this.noiseMessage$.next('');
            this.progress$.next(1);
        };
        
        loop();
    }
    
    private validateNoiseLevel(noiseDbfs: number) {
        if (noiseDbfs <= this.NOISE_THRESHOLD_DBFS) {
            this.noiseStatus$.next(ValidationStatus.Valid);
            this.noiseMessage$.next('El entorno es silencioso, todo correcto.');
        } else {
            this.noiseStatus$.next(ValidationStatus.Invalid);
            this.noiseMessage$.next('Demasiado ruido ambiental. Busca un lugar más tranquilo.');
        }
    }
    
    confirmNoiseCheck() {
        if (this.state$.value !== CalibState.NoiseMeasuring) return;
        if (this.progress$.value < 1) return;
        // Solo confirmación local, sin envío a backend aún
    }
    
    async startInputMeasurement() {
        if (this.state$.value !== CalibState.NoiseMeasuring) return;
        this.inputStatus$.next(ValidationStatus.Pending);
        this.inputMessage$.next('');

        const analyser = this.audio.getAnalyser();
        if (!analyser) {
            this.handleError('No se detectó el micrófono activo. Vuelve a Preparación e inténtalo de nuevo.');
            return;
        }

        // Warm-up del detector para evitar perder los primeros segundos de voz
        // (compilación inicial de TF/WebGL + primera inferencia de CREPE).
        await this.pitch.initialize(analyser);
        await this.warmupPitchDetector();

        await this.startGainCheck();
    }

    private async warmupPitchDetector(): Promise<void> {
        try {
            for (let i = 0; i < 2; i++) {
                await this.pitch.detectPitch();
                await new Promise(resolve => setTimeout(resolve, 60));
            }
        } catch {
            // Si falla warm-up, dejamos que la medición continúe normalmente.
        }
    }

    private async startGainCheck() {
        this.state$.next(CalibState.InputMeasuring);
        this.progress$.next(0);
        
        const analyser = this.audio.getAnalyser();
        if (!analyser) return;

        const durationSec = 15;
        const td = new Uint8Array(analyser.fftSize);
        const start = performance.now();
        let sumRms = 0;
        let frameCount = 0;

        const dynamicVoiceThresholdDb = Math.max(this.RMS_MIN_DB, this.noiseFloorDbfs + 10);
        const minSilenceMs = 320;
        const minSegmentMs = 350;
        const pitchGraceMs = 240;

        let voiceActive = false;
        let segmentStartMs = 0;
        let lastVoiceMs = 0;
        let segmentRmsSum = 0;
        let segmentFrames = 0;
        let segmentMinRms = Number.POSITIVE_INFINITY;
        const segments: { durationMs: number; avgRmsDb: number; minRmsDb: number }[] = [];

        let lastPitchCheckMs = 0;
        const pitchSampleIntervalMs = 100;
        let lastPitchVoiceMs = 0;
        let pitchFrameCount = 0;
        let pitchValidCount = 0;
        let confidenceSum = 0;
        let confidenceCount = 0;
        const pitchValues: number[] = [];

        const loop = async () => {
            const elapsed = (performance.now() - start) / 1000;
            const progress = Math.min(1, elapsed / durationSec);
            this.progress$.next(progress);

            analyser.getByteTimeDomainData(td);
            const { rms } = this.timeDomainRms(td);
            const dbfs = 20 * Math.log10(Math.max(rms, 1e-6));
            
            sumRms += dbfs;
            frameCount++;

            this.inputRmsDb$.next(dbfs);
            this.showInputFeedback(dbfs);

            if (performance.now() - lastPitchCheckMs >= pitchSampleIntervalMs) {
                lastPitchCheckMs = performance.now();
                const pitchResult = await this.pitch.detectPitch();
                if (pitchResult.frequency > 0) {
                    pitchFrameCount += 1;
                    confidenceSum += pitchResult.confidence;
                    confidenceCount += 1;

                    const isVoiceFrame =
                        pitchResult.midiNote > 0 &&
                        pitchResult.confidence >= this.MIN_PITCH_CONFIDENCE &&
                        dbfs >= dynamicVoiceThresholdDb;

                    if (isVoiceFrame) {
                        pitchValidCount += 1;
                        pitchValues.push(pitchResult.midiNote);
                        lastPitchVoiceMs = performance.now();
                    }
                }
            }

            const now = performance.now();
            const hasRecentPitchVoice = now - lastPitchVoiceMs <= pitchGraceMs;
            const isVoiceNow = dbfs >= dynamicVoiceThresholdDb && hasRecentPitchVoice;

            if (isVoiceNow) {
                if (!voiceActive) {
                    voiceActive = true;
                    segmentStartMs = now;
                    segmentRmsSum = 0;
                    segmentFrames = 0;
                    segmentMinRms = Number.POSITIVE_INFINITY;
                }
                lastVoiceMs = now;
                segmentRmsSum += dbfs;
                segmentFrames += 1;
                if (dbfs < segmentMinRms) {
                    segmentMinRms = dbfs;
                }
            } else if (voiceActive && now - lastVoiceMs >= minSilenceMs) {
                const durationMs = now - segmentStartMs;
                if (durationMs >= minSegmentMs && segmentFrames > 0) {
                    const segment = {
                        durationMs,
                        avgRmsDb: segmentRmsSum / segmentFrames,
                        minRmsDb: Number.isFinite(segmentMinRms) ? segmentMinRms : segmentRmsSum / segmentFrames
                    };
                    segments.push(segment);
                    console.log('[Calibration] Probando detectado:', segment);
                }
                voiceActive = false;
            }

            if (elapsed < durationSec) {
                requestAnimationFrame(loop);
            } else {
                if (voiceActive) {
                    const durationMs = performance.now() - segmentStartMs;
                    if (durationMs >= minSegmentMs && segmentFrames > 0) {
                        const segment = {
                            durationMs,
                            avgRmsDb: segmentRmsSum / segmentFrames,
                            minRmsDb: Number.isFinite(segmentMinRms) ? segmentMinRms : segmentRmsSum / segmentFrames
                        };
                        segments.push(segment);
                        console.log('[Calibration] Probando detectado:', segment);
                    }
                    voiceActive = false;
                }

                const avgRmsDb = frameCount > 0 ? sumRms / frameCount : -90;
                this.signalRmsDb = avgRmsDb;

                const pitchValidRate = pitchFrameCount > 0 ? pitchValidCount / pitchFrameCount : 0;
                const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;
                const medianPitch = this.calculateMedian(pitchValues);
                const pitchStd = this.calculateStd(pitchValues, medianPitch);

                const minRmsValues = segments.map(segment => segment.minRmsDb);
                const avgMinRmsDb = minRmsValues.length
                    ? (minRmsValues.reduce((sum, value) => sum + value, 0) / minRmsValues.length) - 3
                    : avgRmsDb - 3;

                this.persistVoiceProfile({
                    avgRmsDb,
                    noiseFloorDbfs: this.noiseFloorDbfs,
                    snrDb: Math.abs(this.noiseFloorDbfs - avgRmsDb),
                    pitchValidRate,
                    avgConfidence,
                    medianPitch,
                    pitchStd,
                    avgMinRmsDb
                });

                console.log('[Calibration] RMS mínimo promedio (Probando):', avgMinRmsDb.toFixed(2), 'dB');

                this.validateProbandoSegments(segments, pitchValidRate, avgConfidence, pitchStd);
                this.progress$.next(1);
            }
        };
        
        loop();
    }
    
    private showInputFeedback(rmsDb: number) {
        if (rmsDb < this.RMS_MIN_DB) {
            this.tip$.next('Habla más fuerte');
        } else if (rmsDb > this.RMS_MAX_DB) {
            this.tip$.next('Baja el volumen');
        } else {
            this.tip$.next('¡Perfecto! Mantén ese nivel');
        }
    }
    
    private validateProbandoSegments(
        segments: { durationMs: number; avgRmsDb: number }[],
        pitchValidRate: number,
        avgConfidence: number,
        pitchStd: number
    ) {
        if (segments.length !== 3) {
            this.inputStatus$.next(ValidationStatus.Invalid);
            this.inputMessage$.next('Debes decir “Probando” exactamente 3 veces.');
            this.tip$.next('Intenta mantener un volumen parecido en cada repetición.');
            return;
        }

        const avgDuration = segments.reduce((sum, s) => sum + s.durationMs, 0) / segments.length;
        const avgRmsDb = segments.reduce((sum, s) => sum + s.avgRmsDb, 0) / segments.length;

        const maxDurationDelta = avgDuration * 0.4;
        const maxRmsDelta = 6;

        const durationOk = segments.every(s => Math.abs(s.durationMs - avgDuration) <= maxDurationDelta);
        const rmsOk = segments.every(s => Math.abs(s.avgRmsDb - avgRmsDb) <= maxRmsDelta);

        console.log('[Calibration] Probando validación:', {
            segments: segments.length,
            durationOk,
            rmsOk
        });

        if (durationOk && rmsOk) {
            this.inputStatus$.next(ValidationStatus.Valid);
            this.inputMessage$.next('Patrón de voz detectado correctamente.');
            this.tip$.next(null);
        } else {
            this.inputStatus$.next(ValidationStatus.Invalid);
            this.inputMessage$.next('Las 3 repeticiones deben ser similares y con voz clara.');
            this.tip$.next('Di “Probando” con ritmo y volumen parecidos.');
        }
    }

    private calculateMedian(values: number[]): number {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    private calculateStd(values: number[], mean: number): number {
        if (values.length < 2) return 0;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    private persistVoiceProfile(profile: {
        avgRmsDb: number;
        noiseFloorDbfs: number;
        snrDb: number;
        pitchValidRate: number;
        avgConfidence: number;
        medianPitch: number;
        pitchStd: number;
        avgMinRmsDb: number;
    }) {
        localStorage.setItem('ursinger.calibration.voiceProfile', JSON.stringify(profile));
    }
    
    async confirmInputAndFinish() {
        if (this.state$.value !== CalibState.InputMeasuring) return;
        
        if (this.inputStatus$.value !== ValidationStatus.Valid) {
            this.inputStatus$.next(ValidationStatus.Pending);
            this.inputMessage$.next('');
            this.tip$.next(null);
            this.startGainCheck();
            return;
        }
        
        // Enviar datos a backend
        await this.sendCalibrationData();
    }
    
    private async sendCalibrationData() {
        try {
            const profileId = localStorage.getItem('profile_id');
            if (!profileId) {
                throw new Error('No se encontró el profile ID. Por favor inicia sesión nuevamente.');
            }

            const deviceIdHash = localStorage.getItem('ursinger.prep.deviceHash') || 'unknown';
            const sampleRate = Number(localStorage.getItem('ursinger.prep.sampleRate') || 48000);
            const snrDb = Math.abs(this.noiseFloorDbfs - this.signalRmsDb);

            const payload: CalibrationPayload = {
                profileId,
                sessionId: this.sessionId!,
                deviceIdHash,
                sampleRate,
                noiseFloorDbfs: this.noiseFloorDbfs,
                snrDb
            };

            await firstValueFrom(
                this.http.post(
                    `${environment.API_BASE_URL}/calibrations`,
                    payload
                )
            );

            this.state$.next(CalibState.Done);
            this.progress$.next(1);
            
        } catch (error: any) {
            this.handleError('Error al enviar datos de calibración: ' + (error.message || 'Error desconocido'));
        }
    }

    private timeDomainRms(buf: Uint8Array): { rms: number } {
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        return { rms };
    }

    private handleError(message: string) {
        this.state$.next(CalibState.Error);
        this.errorMessage$.next(message);
    }

    getSessionId(): string | null {
        return this.sessionId || localStorage.getItem('ursinger.checkup.sessionId');
    }

    clearSession() {
        this.sessionId = undefined;
        localStorage.removeItem('ursinger.checkup.sessionId');
    }

    reset() {
        this.state$.next(CalibState.Idle);
        this.progress$.next(0);
        this.noiseDbfs$.next(null);
        this.inputRmsDb$.next(null);
        this.errorMessage$.next(null);
        this.tip$.next(null);
        this.noiseStatus$.next(ValidationStatus.Pending);
        this.inputStatus$.next(ValidationStatus.Pending);
        this.noiseMessage$.next('');
        this.inputMessage$.next('');
        this.sessionId = undefined;
        this.noiseFloorDbfs = -90;
        this.signalRmsDb = -30;
    }

    getNoiseFloorDbfs(): number {
        return this.noiseFloorDbfs;
    }

    getAverageRmsDb(): number {
        return this.signalRmsDb;
    }
}
