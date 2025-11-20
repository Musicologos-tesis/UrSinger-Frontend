import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment.development';
import { AudioAnalyzerService } from './audio.analyzer.service';
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

        const tickIntervalSec = 3;
        const td = new Uint8Array(analyser.fftSize);
        let tickStart = performance.now();
        let sumDbfs = 0;
        let frameCount = 0;
        
        this.noiseStatus$.next(ValidationStatus.Pending);
        this.noiseMessage$.next('');

        const loop = () => {
            if (this.state$.value !== CalibState.NoiseMeasuring) return;

            const now = performance.now();
            const elapsedSinceTick = (now - tickStart) / 1000;
            const progress = Math.min(1, elapsedSinceTick / tickIntervalSec);
            this.progress$.next(progress);

            analyser.getByteTimeDomainData(td);
            const { rms } = this.timeDomainRms(td);
            const dbfs = 20 * Math.log10(Math.max(rms, 1e-6));
            
            sumDbfs += dbfs;
            frameCount++;
            this.noiseDbfs$.next(dbfs);

            if (elapsedSinceTick >= tickIntervalSec) {
                const avgNoiseFloorDbfs = frameCount > 0 ? sumDbfs / frameCount : -90;
                this.noiseFloorDbfs = avgNoiseFloorDbfs;
                
                this.validateNoiseLevel(avgNoiseFloorDbfs);
                
                sumDbfs = 0;
                frameCount = 0;
                tickStart = now;
                this.progress$.next(0);
            }

            requestAnimationFrame(loop);
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
        if (this.noiseStatus$.value !== ValidationStatus.Valid) return;
        // Solo confirmación local, sin envío a backend aún
    }
    
    startInputMeasurement() {
        if (this.state$.value !== CalibState.NoiseMeasuring) return;
        this.inputStatus$.next(ValidationStatus.Pending);
        this.inputMessage$.next('');
        this.startGainCheck();
    }

    private startGainCheck() {
        this.state$.next(CalibState.InputMeasuring);
        this.progress$.next(0);
        
        const analyser = this.audio.getAnalyser();
        if (!analyser) return;

        const durationSec = 5;
        const td = new Uint8Array(analyser.fftSize);
        const start = performance.now();
        let sumRms = 0;
        let frameCount = 0;

        const loop = () => {
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

            if (elapsed < durationSec) {
                requestAnimationFrame(loop);
            } else {
                const avgRmsDb = frameCount > 0 ? sumRms / frameCount : -90;
                this.signalRmsDb = avgRmsDb;
                
                this.validateInputLevel(avgRmsDb);
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
    
    private validateInputLevel(rmsDb: number) {
        if (rmsDb >= this.RMS_MIN_DB && rmsDb <= this.RMS_MAX_DB) {
            this.inputStatus$.next(ValidationStatus.Valid);
            this.inputMessage$.next('Buen nivel de entrada. Tu voz se escucha perfectamente.');
            this.tip$.next(null);
        } else if (rmsDb < this.RMS_MIN_DB) {
            this.inputStatus$.next(ValidationStatus.Invalid);
            this.inputMessage$.next('Tu voz está muy baja.');
            this.tip$.next('Intenta hablar más fuerte o acércate al micrófono');
        } else {
            this.inputStatus$.next(ValidationStatus.Invalid);
            this.inputMessage$.next('Tu voz está muy alta.');
            this.tip$.next('Baja el volumen o aléjate del micrófono');
        }
    }
    
    async confirmInputAndFinish() {
        if (this.state$.value !== CalibState.InputMeasuring) return;
        
        if (this.inputStatus$.value !== ValidationStatus.Valid) {
            // Reintentar
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
