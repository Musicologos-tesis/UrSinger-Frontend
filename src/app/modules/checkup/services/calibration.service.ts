import { Injectable, inject } from '@angular/core';
import { v4 as uuid } from 'uuid';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
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

interface CalibrationThresholds {
    noise_floor_threshold_dbfs: number;
    snr_min_db: number;
    rms_target_range_db: [number, number];
    clip_tolerance: number;
    pitch_tolerance_cents: number;
    window_agg_ms: number;
}

interface StartCalibrationResponse {
    thresholds: CalibrationThresholds;
}

interface RoomStartPayload {
    sessionId: string;
}

interface RoomTickPayload {
    sessionId: string;
    progress?: number;
    noiseDbfs?: number;
    rmsDb?: number;
}

interface RoomEndPayload {
    sessionId: string;
    phase: 'noise' | 'input';
    metrics?: any;
}

interface RoomErrorPayload {
    sessionId: string;
    message: string;
}

@Injectable({ providedIn: 'root' })
export class CalibrationService {
    private http = inject(HttpClient);
    private audio = inject(AudioAnalyzerService);
    private socket?: Socket;
    private sessionId?: string;
    private phaseTimeout?: number;
    private thresholds?: CalibrationThresholds;
    private noiseFloorDbfs?: number;
    
    // Datos recopilados para /finish
    private finalRmsDb: number = 0;
    private finalStdRmsDb: number = 0;
    private clipEventsCount: number = 0;
    private totalSamples: number = 0;
    private measuredLatencyMs: number = 0;

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
            
            // Reset métricas
            this.finalRmsDb = 0;
            this.clipEventsCount = 0;
            this.totalSamples = 0;
            this.measuredLatencyMs = this.calculateLatency();
            
            // Generar sessionId y guardarlo en localStorage para reutilizar en próximos pasos
            this.sessionId = uuid();
            localStorage.setItem('ursinger.checkup.sessionId', this.sessionId);
            this.log('session_created', { sessionId: this.sessionId });
            
            const deviceIdHash = localStorage.getItem('ursinger.prep.deviceHash') || 'unknown';
            const sampleRate = Number(localStorage.getItem('ursinger.prep.sampleRate') || 48000);
            const appVersion = '0.1.0';
            const osInfo = this.getOsInfo();
            
            // Llamar a POST /calibrations/start
            const response = await firstValueFrom(
                this.http.post<StartCalibrationResponse>(
                    environment.API_BASE_URL + '/calibrations/start',
                    {
                        sessionId: this.sessionId,
                        deviceIdHash,
                        sampleRate,
                        appVersion,
                        osInfo
                    }
                )
            );
            
            this.thresholds = response.thresholds;
            this.log('thresholds_received', { thresholds: this.thresholds });
            
            // Conectar WebSocket
            await this.connectSocket();
            
            // Notificar dispositivo seleccionado
            this.socket?.emit('device:selected', {
                sessionId: this.sessionId,
                deviceIdHash,
                sampleRate
            });
            
            // Iniciar fase de ruido
            this.state$.next(CalibState.NoiseMeasuring);
            this.progress$.next(0);
            this.startRoomCheck();
            
        } catch (error: any) {
            this.handleError(error.message || 'Error al iniciar calibración');
        }
    }

    private getOsInfo(): string {
        const plat = (navigator as any).userAgentData?.platform || navigator.platform || '';
        const brands = (navigator as any).userAgentData?.brands?.map((b:any)=>b.brand+'/'+b.version).join(', ');
        const ua = navigator.userAgent;
        return [plat, brands, ua].filter(Boolean).join(' | ');
    }

    private startRoomCheck() {
        const analyser = this.audio.getAnalyser();
        if (!analyser) return;

        const tickIntervalSec = 3; // Generar tick cada 3 segundos
        const td = new Uint8Array(analyser.fftSize);
        let tickStart = performance.now();
        let sumDbfs = 0;
        let frameCount = 0;
        let tickCount = 0;
        
        // Estado inicial: sin validación hasta completar primer tick
        this.noiseStatus$.next(ValidationStatus.Pending);
        this.noiseMessage$.next('');

        const loop = () => {
            if (this.state$.value !== CalibState.NoiseMeasuring) return;

            const now = performance.now();
            const elapsedSinceTick = (now - tickStart) / 1000;
            const progress = Math.min(1, elapsedSinceTick / tickIntervalSec);
            this.progress$.next(progress);

            // Recolectar datos continuamente
            analyser.getByteTimeDomainData(td);
            const { rms } = this.timeDomainRms(td);
            const dbfs = 20 * Math.log10(Math.max(rms, 1e-6));
            
            sumDbfs += dbfs;
            frameCount++;
            this.noiseDbfs$.next(dbfs); // Solo para feedback visual

            // Cuando se completan 3 segundos: crear tick
            if (elapsedSinceTick >= tickIntervalSec) {
                // Calcular promedio de los últimos 3 segundos
                const avgNoiseFloorDbfs = frameCount > 0 ? sumDbfs / frameCount : -90;
                this.noiseFloorDbfs = avgNoiseFloorDbfs; // Guardar el ÚLTIMO tick
                tickCount++;
                
                this.log('room_tick', { tickNumber: tickCount, noiseFloorDbfs: avgNoiseFloorDbfs });
                
                // SOLO validar (NO enviar a BD aún)
                this.validateNoiseLevel(avgNoiseFloorDbfs);
                
                // Reset para el siguiente tick
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
        const threshold = this.thresholds?.noise_floor_threshold_dbfs || -40;
        
        if (noiseDbfs <= threshold) {
            this.noiseStatus$.next(ValidationStatus.Valid);
            this.noiseMessage$.next('El entorno es silencioso, todo correcto.');
        } else {
            this.noiseStatus$.next(ValidationStatus.Invalid);
            this.noiseMessage$.next('Demasiado ruido ambiental. Busca un lugar más tranquilo.');
        }
    }
    
    // Método público para confirmar el ÚLTIMO tick y enviarlo a BD
    confirmNoiseCheck() {
        if (this.state$.value !== CalibState.NoiseMeasuring) return;
        if (this.noiseStatus$.value !== ValidationStatus.Valid) return;
        
        // Enviar solo el ÚLTIMO tick válido a BD mediante room_check
        this.socket?.emit('room_check', {
            sessionId: this.sessionId,
            noiseFloorDbfs: this.noiseFloorDbfs || -90,
            baseLatencyMs: this.measuredLatencyMs,
            durationSec: 3
        });

        this.log('room_check_confirmed', { noiseFloorDbfs: this.noiseFloorDbfs });
    }
    
    // Método público para iniciar fase de ganancia manualmente
    startInputMeasurement() {
        if (this.state$.value !== CalibState.NoiseMeasuring) return;        this.inputStatus$.next(ValidationStatus.Pending);
        this.inputMessage$.next('');
        this.startGainCheck();
    }

    private startGainCheck() {
        this.state$.next(CalibState.InputMeasuring);
        this.progress$.next(0);
        
        const analyser = this.audio.getAnalyser();
        if (!analyser) return;

        const durationSec = 5; // 5 segundos para medir nivel de entrada
        const td = new Uint8Array(analyser.fftSize);
        const start = performance.now();
        let sumRms = 0, sumSqRms = 0;
        let frameCount = 0;
        let clipCount = 0;

        const loop = () => {
            const elapsed = (performance.now() - start) / 1000;
            const progress = Math.min(1, elapsed / durationSec);
            this.progress$.next(progress);

            analyser.getByteTimeDomainData(td);
            const { rms, clipped } = this.timeDomainRmsAndClip(td);
            const dbfs = 20 * Math.log10(Math.max(rms, 1e-6));
            
            sumRms += rms;
            sumSqRms += rms * rms;
            frameCount++;
            if (clipped) clipCount++;

            this.inputRmsDb$.next(dbfs);
            
            // Mostrar feedback visual en tiempo real pero sin validar
            this.showInputFeedback(dbfs);

            if (elapsed < durationSec) {
                requestAnimationFrame(loop);
            } else {
                // Al terminar los 5 segundos, calcular promedio y validar
                const avgRms = frameCount > 0 ? sumRms / frameCount : 0;
                const variance = frameCount > 0 ? (sumSqRms / frameCount) - (avgRms * avgRms) : 0;
                const stdRms = Math.sqrt(Math.max(0, variance));
                const avgRmsDb = 20 * Math.log10(Math.max(avgRms, 1e-6));
                const stdRmsDb = stdRms > 0 ? 20 * Math.log10(stdRms) : 0;
                const clipRate = frameCount > 0 ? clipCount / frameCount : 0;
                
                // Guardar métricas finales (NO enviar a BD aún)
                this.finalRmsDb = avgRmsDb;
                this.finalStdRmsDb = stdRmsDb;
                this.clipEventsCount = clipCount;
                this.totalSamples = frameCount;
                
                // Validar el resultado
                this.validateInputLevel(avgRmsDb);
                
                // ❌ NO enviar gain_tick aquí, se enviará cuando usuario confirme
                this.log('gain_measurement_complete', { avgRmsDb, stdRmsDb, clipRate });
                this.progress$.next(1);
            }
        };
        
        loop();
    }
    
    private showInputFeedback(rmsDb: number) {
        // Solo mostrar feedback visual, sin cambiar el estado de validación
        if (!this.thresholds?.rms_target_range_db) return;
        
        const [min, max] = this.thresholds.rms_target_range_db;
        
        if (rmsDb < min) {
            this.tip$.next('Habla más fuerte');
        } else if (rmsDb > max) {
            this.tip$.next('Baja el volumen');
        } else {
            this.tip$.next('¡Perfecto! Mantén ese nivel');
        }
    }
    
    private validateInputLevel(rmsDb: number) {
        if (!this.thresholds?.rms_target_range_db) return;
        
        const [min, max] = this.thresholds.rms_target_range_db;
        
        if (rmsDb >= min && rmsDb <= max) {
            this.inputStatus$.next(ValidationStatus.Valid);
            this.inputMessage$.next('Buen nivel de entrada. Tu voz se escucha perfectamente.');
            this.tip$.next(null);
        } else if (rmsDb < min) {
            this.inputStatus$.next(ValidationStatus.Invalid);
            this.inputMessage$.next('Tu voz está muy baja.');
            this.tip$.next('Intenta hablar más fuerte o acércate al micrófono');
        } else {
            this.inputStatus$.next(ValidationStatus.Invalid);
            this.inputMessage$.next('Tu voz está muy alta.');
            this.tip$.next('Baja el volumen o aléjate del micrófono');
        }
    }
    
    // Método público para confirmar nivel de entrada y finalizar
    async confirmInputAndFinish() {
        if (this.state$.value !== CalibState.InputMeasuring) return;
        
        if (this.inputStatus$.value !== ValidationStatus.Valid) {
            // Si no es válido, reiniciar la fase de entrada
            this.inputStatus$.next(ValidationStatus.Pending);
            this.inputMessage$.next('');
            this.tip$.next(null);
            this.startGainCheck();
            return;
        }
        
        // Si es válido, primero enviar gain_tick (el último tick)
        const windowMs = 5000;
        const clipRate = this.totalSamples > 0 ? this.clipEventsCount / this.totalSamples : 0;
        const snrDb = this.calculateSnr(this.finalRmsDb);
        
        this.socket?.emit('gain_tick', {
            sessionId: this.sessionId,
            windowMs,
            avgRmsDb: this.finalRmsDb,
            stdRmsDb: this.finalStdRmsDb,
            clipRate,
            snrDb
        });

        this.log('gain_tick_sent', { avgRmsDb: this.finalRmsDb, stdRmsDb: this.finalStdRmsDb, clipRate, snrDb });
        
        // Luego finalizar calibración completa
        await this.completeCalibration();
    }
    
    // Método público para finalizar calibración manualmente
    async completeCalibration() {
        if (this.state$.value !== CalibState.InputMeasuring) return;
        
        // Enviar metrics_tick final con stdRmsDb
        const windowMs = this.thresholds?.window_agg_ms || 5000;
        const snrDb = this.calculateSnr(this.finalRmsDb);
        const clipRate = this.totalSamples > 0 ? this.clipEventsCount / this.totalSamples : 0;
        
        await this.sendMetricsTick(windowMs, this.finalRmsDb, this.finalStdRmsDb, clipRate);
        
        // Finalizar calibración con POST /calibrations/finish
        await this.finishCalibration();
    }

    private sendMetricsTick(windowMs: number, avgRmsDb: number, stdRmsDb: number, clipRate: number) {
        const snrDb = this.calculateSnr(avgRmsDb);
        
        this.socket?.emit('metrics_tick', {
            sessionId: this.sessionId,
            windowMs,
            avgRmsDb,
            stdRmsDb,
            clipRate,
            snrDb,
            baseLatencyMs: this.measuredLatencyMs,
            noiseFloorDbfs: this.noiseFloorDbfs || -90,
            result: 'OK'
        });

        this.log('metrics_tick_sent', { avgRmsDb, stdRmsDb, snrDb, clipRate, noiseFloorDbfs: this.noiseFloorDbfs });
    }

    private async finishCalibration() {
        try {
            const snrDb = this.calculateSnr(this.finalRmsDb);
            
            const finishData = {
                sessionId: this.sessionId,
                observedRmsDb: this.finalRmsDb,
                clipEvents: this.clipEventsCount,
                latencyMs: this.measuredLatencyMs,
                tunerOffsetCents: null, // Opcional: implementar si hay afinador
                room: {
                    noiseFloorDbfs: this.noiseFloorDbfs || -90,
                    snrDb: snrDb
                }
            };

            const response = await firstValueFrom(
                this.http.post<any>(
                    environment.API_BASE_URL + '/calibrations/finish',
                    finishData
                )
            );

            this.log('calibration_finished', { profile: response.profile });
            
            // Completar UI
            this.state$.next(CalibState.Done);
            this.progress$.next(1);
            this.disconnect();
            
        } catch (error: any) {
            this.handleError('Error al finalizar calibración: ' + (error.message || 'Error desconocido'));
        }
    }

    private calculateSnr(signalRmsDb: number): number {
        if (!this.noiseFloorDbfs) return 0;
        return Math.abs(this.noiseFloorDbfs - signalRmsDb);
    }

    private calculateLatency(): number {
        try {
            const ctx = (this.audio as any).ctx;
            if (ctx && ctx.baseLatency !== undefined) {
                return Math.round(ctx.baseLatency * 1000); // Convertir a ms
            }
        } catch (e) {
            // Ignorar errores
        }
        return 0; // Fallback si no está disponible
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

    private timeDomainRmsAndClip(buf: Uint8Array): { rms: number; clipped: boolean } {
        let sum = 0, clipped = false;
        for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
            if (Math.abs(v) > 0.98) clipped = true;
        }
        const rms = Math.sqrt(sum / buf.length);
        return { rms, clipped };
    }

    private async connectSocket(): Promise<void> {
        return new Promise((resolve, reject) => {
            const wsUrl = environment.WS_BASE_URL;
            this.socket = io(wsUrl + '/calibration', { 
                transports: ['websocket'],
                reconnection: false
            });
            
            this.socket.on('connect', () => {
                this.log('connect', { socketId: this.socket?.id });
                
                this.socket?.on('room_start', (data: RoomStartPayload) => this.handleRoomStart(data));
                this.socket?.on('room_tick', (data: RoomTickPayload) => this.handleRoomTick(data));
                this.socket?.on('room_end', (data: RoomEndPayload) => this.handleRoomEnd(data));
                this.socket?.on('room_error', (data: RoomErrorPayload) => this.handleRoomError(data));
                
                resolve();
            });
            
            this.socket.on('connect_error', (error) => {
                this.log('connect_error', { error: error.message });
                reject(new Error('Error al conectar con el servidor'));
            });
        });
    }

    private handleRoomStart(data: RoomStartPayload) {
        if (data.sessionId !== this.sessionId) return;
        this.log('room_start', data);
        this.sessionId = data.sessionId;
    }

    private handleRoomTick(data: RoomTickPayload) {
        if (data.sessionId !== this.sessionId) return;
        
        const currentState = this.state$.value;
        
        if (data.progress !== undefined) {
            this.progress$.next(data.progress);
        }
        
        if (currentState === CalibState.NoiseMeasuring && data.noiseDbfs !== undefined) {
            this.noiseDbfs$.next(data.noiseDbfs);
        }
        
        if (currentState === CalibState.InputMeasuring && data.rmsDb !== undefined) {
            this.inputRmsDb$.next(data.rmsDb);
            this.checkRmsRange(data.rmsDb);
        }
    }

    private handleRoomEnd(data: RoomEndPayload) {
        if (data.sessionId !== this.sessionId) return;
        this.log('room_end', data);
        
        this.clearPhaseTimeout();
        
        // Nota: Ya no cambiamos automáticamente a InputMeasuring
        // El usuario debe confirmar manualmente
    }

    private handleRoomError(data: RoomErrorPayload) {
        if (data.sessionId !== this.sessionId) return;
        this.log('room_error', data);
        this.handleError(data.message || 'Error en la calibración');
    }

    private checkRmsRange(rmsDb: number) {
        // Método legacy mantenido para compatibilidad
        this.validateInputLevel(rmsDb);
    }

    private setPhaseTimeout(windowMs: number) {
        this.clearPhaseTimeout();
        this.phaseTimeout = window.setTimeout(() => {
            const phase = this.state$.value === CalibState.NoiseMeasuring ? 'noise' : 'input';
            this.log('timeout', { phase, windowMs });
            this.handleError('Timeout: no se recibió room_end para fase ' + phase);
        }, windowMs + 2000);
    }

    private clearPhaseTimeout() {
        if (this.phaseTimeout) {
            clearTimeout(this.phaseTimeout);
            this.phaseTimeout = undefined;
        }
    }

    private handleError(message: string) {
        this.clearPhaseTimeout();
        this.state$.next(CalibState.Error);
        this.errorMessage$.next(message);
        this.disconnect();
    }

    private disconnect() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = undefined;
        }
    }

    /**
     * Obtiene el sessionId actual (de la calibración en curso o del localStorage)
     * Útil para reutilizar en otros módulos (rango vocal, estabilidad)
     */
    getSessionId(): string | null {
        return this.sessionId || localStorage.getItem('ursinger.checkup.sessionId');
    }

    /**
     * Limpia el sessionId del localStorage
     * Útil cuando se quiere iniciar una nueva sesión completa de checkup
     */
    clearSession() {
        this.sessionId = undefined;
        localStorage.removeItem('ursinger.checkup.sessionId');
        this.log('session_cleared', {});
    }

    reset() {
        this.clearPhaseTimeout();
        this.disconnect();
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
        // Nota: No eliminamos sessionId de localStorage para reutilizar en próximos módulos
        // Para limpiar completamente la sesión, usar clearSession()
        this.sessionId = undefined;
        this.noiseFloorDbfs = undefined;
        this.finalRmsDb = 0;
        this.finalStdRmsDb = 0;
        this.clipEventsCount = 0;
        this.totalSamples = 0;
        this.measuredLatencyMs = 0;
    }

    /**
     * Obtiene el noise floor calibrado (para uso en pitch detection)
     */
    getNoiseFloorDbfs(): number {
        return this.noiseFloorDbfs || -90;
    }

    /**
     * Obtiene el RMS promedio del usuario (para calibración de pitch detector)
     */
    getAverageRmsDb(): number {
        return this.finalRmsDb || -30;
    }

    private log(event: string, data?: any) {
        if (!environment.production) {
            const logData: any = { event };
            if (data?.sessionId) logData.sessionId = data.sessionId;
            if (data?.phase) logData.phase = data.phase;
            if (data?.progress !== undefined) logData.progress = data.progress;
            console.log('[calibration]', logData);
        }
    }

    ngOnDestroy() {
        this.disconnect();
        this.clearPhaseTimeout();
    }
}
