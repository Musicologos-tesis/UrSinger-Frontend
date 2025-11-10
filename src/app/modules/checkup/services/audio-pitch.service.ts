import { Injectable } from '@angular/core';
import { PitchDetector } from 'pitchy';

/**
 * Servicio de detección de pitch (frecuencia fundamental) usando Pitchy (YIN)
 * 
 * Pitchy implementa el algoritmo YIN, robusto para detección de pitch en voces.
 * Accuracy: 85-95% en voces humanas
 * Latencia: ~5-10ms (mucho más rápido que CREPE)
 */
@Injectable({ providedIn: 'root' })
export class AudioPitchService {
    private audioContext?: AudioContext;
    private analyser?: AnalyserNode;
    private pitchDetector?: PitchDetector<Float32Array>;
    private timeDataArray?: Float32Array;
    private frequencyDataArray?: Uint8Array;

    // YIN config optimizado para voces
    private readonly BUFFER_SIZE = 4096; // Buffer grande para detectar graves
    private readonly CLARITY_THRESHOLD = 0.5; // Permisivo para todo el rango vocal

    /**
     * Inicializa el servicio de pitch detection
     */
    async initialize(existingAnalyser?: AnalyserNode): Promise<void> {
        if (existingAnalyser) {
            this.analyser = existingAnalyser;
            this.audioContext = this.analyser.context as AudioContext;
        } else {
            throw new Error('Se requiere un AnalyserNode válido');
        }

        // Configurar buffers
        this.timeDataArray = new Float32Array(this.BUFFER_SIZE);
        this.frequencyDataArray = new Uint8Array(this.analyser.frequencyBinCount);

        // Crear detector YIN
        this.pitchDetector = PitchDetector.forFloat32Array(this.BUFFER_SIZE);
        this.pitchDetector.clarityThreshold = this.CLARITY_THRESHOLD;

        console.log('[AudioPitchService] ✓ Pitchy (YIN) inicializado correctamente');
    }

    /**
     * Detecta pitch usando YIN - SIN filtros anti-ruido
     * 
     * Solo valida:
     * 1. Rango vocal humano (65-1400 Hz)
     * 2. Clarity mínimo del algoritmo YIN
     */
    async detectPitch(): Promise<{ frequency: number; confidence: number; midiNote: number }> {
        if (!this.analyser || !this.timeDataArray || !this.pitchDetector) {
            return { frequency: 0, confidence: 0, midiNote: 0 };
        }

        try {
            // Obtener datos de audio
            // @ts-ignore - ArrayBuffer type issue
            this.analyser.getFloatTimeDomainData(this.timeDataArray);

            // Detectar pitch con YIN
            const [frequency, clarity] = this.pitchDetector.findPitch(
                this.timeDataArray,
                this.audioContext!.sampleRate
            );

            // Validar rango vocal humano (65-1400 Hz)
            if (!frequency || frequency < 65 || frequency > 1400 || !isFinite(frequency)) {
                return { frequency: 0, confidence: 0, midiNote: 0 };
            }

            // Validar clarity mínimo (ser permisivo, especialmente con graves)
            if (clarity < this.CLARITY_THRESHOLD) {
                return { frequency: 0, confidence: 0, midiNote: 0 };
            }

            // Señal válida
            return {
                frequency,
                confidence: clarity,
                midiNote: this.frequencyToMidi(frequency)
            };

        } catch (error) {
            console.error('[AudioPitchService] Error en detectPitch:', error);
            return { frequency: 0, confidence: 0, midiNote: 0 };
        }
    }

    /**
     * Calcula RMS (volumen) en dBFS
     */
    calculateRMS(): number {
        if (!this.analyser || !this.timeDataArray) return -90;

        // @ts-ignore - ArrayBuffer type issue
        this.analyser.getFloatTimeDomainData(this.timeDataArray);

        let sum = 0;
        for (let i = 0; i < this.timeDataArray.length; i++) {
            sum += this.timeDataArray[i] * this.timeDataArray[i];
        }

        const rms = Math.sqrt(sum / this.timeDataArray.length);
        return rms > 0 ? 20 * Math.log10(rms) : -90;
    }

    /**
     * Calcula centroide espectral (brillo del sonido)
     */
    calculateSpectralCentroid(): number {
        if (!this.analyser || !this.frequencyDataArray) return 0;

        // @ts-ignore - ArrayBuffer type issue
        this.analyser.getByteFrequencyData(this.frequencyDataArray);

        let numerator = 0;
        let denominator = 0;
        const nyquist = this.audioContext!.sampleRate / 2;
        const binWidth = nyquist / this.frequencyDataArray.length;

        for (let i = 0; i < this.frequencyDataArray.length; i++) {
            const frequency = i * binWidth;
            const magnitude = this.frequencyDataArray[i] / 255;

            numerator += frequency * magnitude;
            denominator += magnitude;
        }

        return denominator > 0 ? numerator / denominator : 0;
    }

    /**
     * Convierte frecuencia a MIDI
     */
    frequencyToMidi(frequency: number): number {
        if (frequency <= 0) return 0;
        return Math.round(12 * Math.log2(frequency / 440) + 69);
    }

    /**
     * Convierte MIDI a nombre de nota
     */
    midiToNoteName(midi: number): string {
        if (midi <= 0) return '';
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midi / 12) - 1;
        const noteName = noteNames[midi % 12];
        return `${noteName}${octave}`;
    }

    /**
     * Convierte MIDI a frecuencia
     */
    midiToFrequency(midi: number): number {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    /**
     * Verifica si el servicio está listo
     */
    isReady(): boolean {
        return !!this.pitchDetector && !!this.analyser && !!this.timeDataArray;
    }

    /**
     * Limpia recursos
     */
    cleanup(): void {
        this.pitchDetector = undefined;
        this.analyser = undefined;
        this.timeDataArray = undefined;
        this.frequencyDataArray = undefined;
    }

    /**
     * Alias para cleanup (compatibilidad)
     */
    destroy(): void {
        this.cleanup();
    }
}
