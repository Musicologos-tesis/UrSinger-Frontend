# Implementación de Calibración Automática - UrSinger

## ✅ Criterios de Aceptación

1. ✅ Al pulsar Calibrar, la UI progresa automáticamente: Ruido ambiente → Nivel de entrada → Listo
2. ✅ Botón Continuar habilitado solo en CalibState.Done
3. ✅ Barra de progreso visible con room_tick.progress
4. ✅ Timeout con mensaje de error si falta room_end
5. ✅ Nombres de eventos exactos: room_start, room_tick, room_end, room_error, start_noise, start_input
6. ✅ Sin errores "analyser-not-ready"

## 📁 Archivos a Modificar

### 1. `calibration.service.ts` - Máquina de Estados

```typescript
import { Injectable, inject } from '@angular/core';
import { v4 as uuid } from 'uuid';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../../environments/environment.development';
import { AudioAnalyzerService } from './audio.analyzer.service';
import { BehaviorSubject } from 'rxjs';

export enum CalibState {
    Idle = 'idle',
    NoiseMeasuring = 'noise_measuring',
    InputMeasuring = 'input_measuring',
    Done = 'done',
    Error = 'error'
}

interface CalibrationConfig {
    window_agg_ms?: number;
    rms_target_range_db?: [number, number];
    noise_floor_max_dbfs?: number;
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
    private config?: CalibrationConfig;

    readonly state$ = new BehaviorSubject<CalibState>(CalibState.Idle);
    readonly progress$ = new BehaviorSubject<number>(0);
    readonly noiseDbfs$ = new BehaviorSubject<number | null>(null);
    readonly inputRmsDb$ = new BehaviorSubject<number | null>(null);
    readonly errorMessage$ = new BehaviorSubject<string | null>(null);
    readonly tip$ = new BehaviorSubject<string | null>(null);

    async startCalibration(thresholds: CalibrationConfig) {
        try {
            const analyser = this.audio.getAnalyser();
            if (!analyser) {
                throw new Error('El micrófono debe estar activado antes de calibrar. Vuelve a la página de preparación.');
            }

            this.config = thresholds;
            this.errorMessage$.next(null);
            this.tip$.next(null);
            
            this.sessionId = uuid();
            await this.connectSocket();
            
            this.state$.next(CalibState.NoiseMeasuring);
            this.progress$.next(0);
            
            this.log('start_noise', { sessionId: this.sessionId, windowMs: thresholds.window_agg_ms || 5000 });
            this.socket?.emit('start_noise', { 
                sessionId: this.sessionId, 
                windowMs: thresholds.window_agg_ms || 5000 
            });
            
            this.setPhaseTimeout(thresholds.window_agg_ms || 5000);
            
        } catch (error: any) {
            this.handleError(error.message || 'Error al iniciar calibración');
        }
    }

    private async connectSocket(): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = `${environment.WS_BASE_URL}/calibration`;
            this.socket = io(url, { 
                transports: ['websocket'],
                reconnection: false
            });
            
            this.socket.on('connect', () => {
                this.log('connect', { socketId: this.socket?.id });
                
                // Suscribirse a TODOS los eventos ANTES de emitir start_*
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

    // 🔥 CLAVE: Encadena automáticamente las fases
    private handleRoomEnd(data: RoomEndPayload) {
        if (data.sessionId !== this.sessionId) return;
        this.log('room_end', data);
        
        this.clearPhaseTimeout();
        
        if (data.phase === 'noise') {
            // Fase de ruido completada → iniciar fase de entrada AUTOMÁTICAMENTE
            this.state$.next(CalibState.InputMeasuring);
            this.progress$.next(0);
            this.tip$.next(null);
            
            this.log('start_input', { sessionId: this.sessionId });
            this.socket?.emit('start_input', { sessionId: this.sessionId });
            
            this.setPhaseTimeout(this.config?.window_agg_ms || 5000);
            
        } else if (data.phase === 'input') {
            // Fase de entrada completada → Done
            this.state$.next(CalibState.Done);
            this.progress$.next(1);
            this.tip$.next(null);
            this.disconnect();
        }
    }

    private handleRoomError(data: RoomErrorPayload) {
        if (data.sessionId !== this.sessionId) return;
        this.log('room_error', data);
        this.handleError(data.message || 'Error en la calibración');
    }

    private checkRmsRange(rmsDb: number) {
        if (!this.config?.rms_target_range_db) return;
        
        const [min, max] = this.config.rms_target_range_db;
        
        if (rmsDb < min) {
            this.tip$.next('Habla más fuerte');
        } else if (rmsDb > max) {
            this.tip$.next('Baja la ganancia del micrófono');
        } else {
            this.tip$.next(null);
        }
    }

    // 🔥 Timeout de seguridad
    private setPhaseTimeout(windowMs: number) {
        this.clearPhaseTimeout();
        this.phaseTimeout = window.setTimeout(() => {
            const phase = this.state$.value === CalibState.NoiseMeasuring ? 'noise' : 'input';
            this.log('timeout', { phase, windowMs });
            this.handleError(`Timeout: no se recibió room_end para fase ${phase}`);
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

    reset() {
        this.clearPhaseTimeout();
        this.disconnect();
        this.state$.next(CalibState.Idle);
        this.progress$.next(0);
        this.noiseDbfs$.next(null);
        this.inputRmsDb$.next(null);
        this.errorMessage$.next(null);
        this.tip$.next(null);
        this.sessionId = undefined;
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
```

### 2. `calibration.ts` - Componente

```typescript
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CalibrationService, CalibState } from '../../services/calibration.service';
import { AudioAnalyzerService } from '../../services/audio.analyzer.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../environments/environment.development';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-calibration',
  imports: [],
  templateUrl: './calibration.html',
  styleUrl: './calibration.scss',
})
export class CalibrationComponent implements OnDestroy {
  private router = inject(Router);
  private cal = inject(CalibrationService);
  private audio = inject(AudioAnalyzerService);
  private http = inject(HttpClient);

  CalibState = CalibState;
  
  state = signal<CalibState>(CalibState.Idle);
  progress = signal(0);
  errorMessage = signal<string | null>(null);
  tip = signal<string | null>(null);
  buttonText = signal('Calibrar');
  buttonDisabled = signal(false);

  constructor() {
    this.cal.state$.subscribe(s => {
      this.state.set(s);
      this.updateUIForState(s);
    });
    
    this.cal.progress$.subscribe(p => this.progress.set(p));
    this.cal.errorMessage$.subscribe(err => this.errorMessage.set(err));
    this.cal.tip$.subscribe(t => this.tip.set(t));
  }

  async onCalibrate() {
    if (this.state() === CalibState.Done) {
      this.router.navigate(['/checkup/range']);
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
      // Resume AudioContext para autoplay policies
      const ctx = (this.audio as any).ctx;
      if (ctx && ctx.state === 'suspended') {
        await ctx.resume();
      }

      this.buttonDisabled.set(true);
      
      // Obtener configuración del backend
      const config = await firstValueFrom(
        this.http.get<any>(`${environment.API_BASE_URL}/calibration/config`)
      );

      // Iniciar calibración - el resto es automático
      await this.cal.startCalibration(config);
      
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Error al iniciar calibración');
      this.cal.reset();
    } finally {
      this.buttonDisabled.set(false);
    }
  }

  private updateUIForState(state: CalibState) {
    switch (state) {
      case CalibState.Idle:
        this.buttonText.set('Calibrar');
        this.buttonDisabled.set(false);
        break;
      case CalibState.NoiseMeasuring:
        this.buttonText.set('Calibrando...');
        this.buttonDisabled.set(true);
        break;
      case CalibState.InputMeasuring:
        this.buttonText.set('Calibrando...');
        this.buttonDisabled.set(true);
        break;
      case CalibState.Done:
        this.buttonText.set('Continuar con el rango vocal');
        this.buttonDisabled.set(false);
        break;
      case CalibState.Error:
        this.buttonText.set('Reintentar');
        this.buttonDisabled.set(false);
        break;
    }
  }

  ngOnDestroy() {
    this.audio.stop();
    this.cal.reset();
  }
}
```

### 3. `calibration.html` - Template

```html
<h1>Chequeo rápido - Calibración</h1>

@if (state() === CalibState.Idle) {
  <p>Cuando estés listo, presiona "Calibrar" para comenzar.</p>
}

@if (state() === CalibState.NoiseMeasuring) {
  <p>🔇 Detectando ruido ambiente...</p>
  <p><small>Mantente en silencio por unos segundos.</small></p>
}

@if (state() === CalibState.InputMeasuring) {
  <p>🎤 Calibrando nivel de entrada...</p>
  <p><small>Di "ahhhh" con un volumen cómodo y natural.</small></p>
  @if (tip()) {
    <p class="tip">💡 {{ tip() }}</p>
  }
}

@if (state() === CalibState.Done) {
  <p>✅ ¡Micrófono calibrado correctamente!</p>
  <p><small>Ahora puedes continuar con el rango vocal.</small></p>
}

@if (state() === CalibState.Error) {
  <div class="error-banner">
    <p>⚠️ No se pudo completar la calibración.</p>
    <p><small>{{ errorMessage() }}</small></p>
    <p><small>Por favor, reintenta.</small></p>
  </div>
}

<div class="tabs">
  <span>● Preparación</span>
  <span class="active">● Calibración</span>
  <span>● Rango</span>
  <span>● Estabilidad</span>
  <span>● Resultados</span>
</div>

<div class="panel">
  <div class="mic-box">
    <div class="mic-circle" 
         [class.pulse]="state() === CalibState.NoiseMeasuring || state() === CalibState.InputMeasuring">
      🎤
    </div>
  </div>

  <div class="right">
    @if (state() === CalibState.NoiseMeasuring || state() === CalibState.InputMeasuring) {
      <div class="progress">
        <div class="bar" [style.width.%]="progress() * 100"></div>
        <small>{{ (progress() * 100).toFixed(0) }}% completado</small>
      </div>
    }

    @if (state() === CalibState.Done) {
      <div class="pill ok">● Micrófono listo</div>
    }
  </div>
</div>

<div class="cta">
  <button class="primary" 
          (click)="onCalibrate()" 
          [disabled]="buttonDisabled()">
    {{ buttonText() }}
  </button>
</div>

@if (state() === CalibState.Idle) {
  <p class="foot">El proceso tomará aproximadamente 10 segundos.</p>
}

@if (state() === CalibState.Done) {
  <p class="foot">Podrás volver a calibrar tu micrófono más adelante si es necesario.</p>
}
```

### 4. `calibration.scss` - Estilos

Agregar estos estilos adicionales:

```scss
.mic-circle {
  transition: transform 0.3s ease;
}

.mic-circle.pulse { 
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.progress .bar { 
  transition: width 0.3s ease; 
}

.primary:disabled { 
  background:#9ca3af; 
  cursor: not-allowed; 
}

.error-banner {
  background:#fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
  color: #991b1b;
}

.tip {
  background:#fffbeb;
  border: 1px solid #fde047;
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 8px;
  color: #854d0e;
  font-weight: 500;
}
```

### 5. `preparation.ts` - NO detener audio

En `ngOnDestroy()`:

```typescript
ngOnDestroy() { 
  // NO detenemos el audio aquí porque se necesita en calibración
  // Se detendrá después de la calibración
}
```

## 🔑 Puntos Clave de la Implementación

1. **Máquina de Estados**: El servicio maneja automáticamente las transiciones
2. **Encadenamiento Automático**: `room_end(phase='noise')` → emite `start_input` automáticamente
3. **Timeout de Seguridad**: Si no llega `room_end` en `windowMs + 2000ms`, error
4. **Filtrado por sessionId**: Ignora eventos de otras sesiones
5. **Suscripciones antes de emit**: Todos los `socket.on()` antes de `socket.emit()`
6. **Un solo click**: El usuario solo presiona "Calibrar" una vez
7. **Logs limpios**: Solo un log por evento con sessionId, phase, progress

## 🧪 Pruebas Manuales

1. **Caso feliz**: room_start → ticks → room_end(noise) → cambia a "Nivel de entrada..." → ticks → room_end(input) → "¡Micrófono calibrado!"
2. **Timeout**: Si no llega room_end, muestra error y resetea
3. **Sesión errónea**: Ignora eventos con otro sessionId
4. **Botón Continuar**: Solo habilitado en CalibState.Done

## 🚀 Implementación

Reemplaza completamente los archivos mencionados con el código proporcionado.
