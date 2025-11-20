import { Injectable } from '@angular/core';
import * as tf from '@tensorflow/tfjs';

/**
 * Servicio de detección de pitch usando CREPE (TensorFlow.js)
 * 
 * CREPE: Convolutional Representation for Pitch Estimation
 * Paper: Kim et al. 2018
 * Precisión: ~97% en voces humanas
 * 
 * Modelo: ml5.js pre-trained CREPE tiny
 */
@Injectable({ providedIn: 'root' })
export class AudioPitchService {
    private audioContext?: AudioContext;
    private analyser?: AnalyserNode;
    private crepeModel?: tf.LayersModel;
    private isModelLoaded = false;
    private timeDataArray?: Float32Array;
    private frequencyDataArray?: Uint8Array;

    // CREPE config
    private readonly MODEL_URL = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models/models/pitch-detection/crepe/model.json';
    private readonly CREPE_SAMPLE_RATE = 16000; // CREPE espera 16kHz
    private readonly CREPE_INPUT_SIZE = 1024; // Ventana de 1024 samples
    
    // Mapeo de CREPE output a frecuencias
    private readonly CREPE_CENTS_PER_BIN = 20; // Cada bin = 20 cents
    private readonly CREPE_BASE_FREQ = 32.70; // C1

    // Auto-ganancia basada en calibración
    private calibratedGain: number = 1.0; // Ganancia para normalizar audio
    private targetRmsDb: number = -20; // Target RMS ideal para CREPE

    /**
     * Inicializa el servicio y carga el modelo CREPE
     */
    async initialize(existingAnalyser?: AnalyserNode): Promise<void> {
        if (existingAnalyser) {
            this.analyser = existingAnalyser;
            this.audioContext = this.analyser.context as AudioContext;
        } else {
            throw new Error('Se requiere un AnalyserNode válido');
        }

        // Configurar buffers
        const bufferSize = 2048;
        this.timeDataArray = new Float32Array(bufferSize);
        this.frequencyDataArray = new Uint8Array(this.analyser.frequencyBinCount);

        // Cargar modelo CREPE si no está cargado
        if (!this.isModelLoaded) {
            await this.loadCrepeModel();
        }

        console.log('[AudioPitchService] ✓ CREPE inicializado correctamente');
    }

    /**
     * Calibra el detector usando métricas de calibración
     * Ajusta automáticamente la ganancia para optimizar CREPE
     * 
     * @param avgRmsDb RMS promedio del usuario durante calibración
     * @param noiseFloorDb Nivel de ruido ambiente
     */
    calibrateFromMetrics(avgRmsDb: number, noiseFloorDb: number): void {
        // Calcular ganancia óptima basada en el RMS del usuario
        // CREPE funciona mejor con señales ~-20 dBFS
        const rmsGap = this.targetRmsDb - avgRmsDb;
        this.calibratedGain = Math.pow(10, rmsGap / 20);
        
        // Limitar ganancia entre 0.5x y 10x
        this.calibratedGain = Math.max(0.5, Math.min(10, this.calibratedGain));
        
        const snr = avgRmsDb - noiseFloorDb;
        
        console.log('[AudioPitchService] Auto-calibrado:', {
            avgRmsDb: avgRmsDb.toFixed(1),
            noiseFloorDb: noiseFloorDb.toFixed(1),
            snr: snr.toFixed(1) + ' dB',
            gain: this.calibratedGain.toFixed(2) + 'x',
            message: this.calibratedGain > 2 ? '⚠️ Voz suave detectada - aplicando ganancia' : '✓ Nivel óptimo'
        });
    }

    /**
     * Carga el modelo CREPE desde CDN
     */
    private async loadCrepeModel(): Promise<void> {
        try {
            console.log('[AudioPitchService] Cargando modelo CREPE desde:', this.MODEL_URL);
            
            // Configurar TensorFlow.js backend
            await tf.ready();
            await tf.setBackend('webgl');
            
            // Cargar modelo
            this.crepeModel = await tf.loadLayersModel(this.MODEL_URL);
            this.isModelLoaded = true;
            
            // Validar que el modelo tiene la forma correcta
            const inputShape = (this.crepeModel as any).inputs[0].shape;
            const outputShape = (this.crepeModel as any).outputs[0].shape;
            
            console.log('[AudioPitchService] ✓ Modelo CREPE cargado exitosamente');
            console.log('[AudioPitchService] Input shape:', inputShape);
            console.log('[AudioPitchService] Output shape:', outputShape);
            
        } catch (error) {
            console.error('[AudioPitchService] Error al cargar modelo CREPE:', error);
            throw new Error('No se pudo cargar el modelo CREPE');
        }
    }

    // Buffer para promedio de confidence en graves
    private confidenceHistory: number[] = [];
    private readonly CONFIDENCE_HISTORY_SIZE = 5;

    /**
     * Detecta pitch usando CREPE
     */
    async detectPitch(): Promise<{ frequency: number; confidence: number; midiNote: number }> {
        if (!this.analyser || !this.timeDataArray || !this.isModelLoaded || !this.crepeModel) {
            return { frequency: 0, confidence: 0, midiNote: 0 };
        }

        try {
            // 1. Obtener audio del analyser
            // @ts-ignore - ArrayBuffer type issue
            this.analyser.getFloatTimeDomainData(this.timeDataArray);

            // 2. Resamplear a 16kHz (CREPE espera 16kHz)
            const resampledData = this.resampleTo16kHz(
                this.timeDataArray,
                this.audioContext!.sampleRate
            );

            // 3. Tomar ventana de 1024 samples
            const windowedData = this.extractWindow(resampledData, this.CREPE_INPUT_SIZE);

            // 3.5. Aplicar ventana de Hanning (reduce spectral leakage para graves)
            const hannedData = this.applyHanningWindow(windowedData);

            // 4. NORMALIZAR audio (CRÍTICO para CREPE)
            const normalizedData = this.normalizeAudio(hannedData);

            // 5. Convertir a tensor [1, 1024] (2D, no 3D)
            const inputTensor = tf.tensor2d(
                Array.from(normalizedData),
                [1, this.CREPE_INPUT_SIZE]
            );

            // 6. Ejecutar modelo CREPE
            const output = this.crepeModel.predict(inputTensor) as tf.Tensor;
            const outputData = await output.data();

            // 7. Limpiar tensores
            inputTensor.dispose();
            output.dispose();

            // 8. Interpretar salida (360 bins de probabilidad)
            let { frequency, confidence } = this.interpretCrepeOutput(outputData);

            // MEJORA PARA GRAVES Y MEDIOS-GRAVES: Aumentar ganancia y promediar confidence
            if (frequency > 0 && frequency < 200) {
                // Aplicar ganancia extra para graves (tienen menos energía armónica)
                // 1.5x boost para mejorar detección (antes 1.3x)
                confidence = Math.min(1.0, confidence * 1.5);
                
                // Promedio móvil de confidence para estabilizar graves
                this.confidenceHistory.push(confidence);
                if (this.confidenceHistory.length > this.CONFIDENCE_HISTORY_SIZE) {
                    this.confidenceHistory.shift();
                }
                confidence = this.confidenceHistory.reduce((a, b) => a + b, 0) / this.confidenceHistory.length;
            } else {
                // Limpiar historial si no es grave
                this.confidenceHistory = [];
            }

            // CORRECCIÓN DE OCTAVAS: Verificar con análisis espectral
            // Los modelos a veces detectan armónicos en lugar de fundamental
            frequency = this.correctOctaveErrors(frequency, normalizedData);

            // DEBUG: Log cada 20 detecciones
            if (Math.random() < 0.05) {
                // Calcular RMS del audio normalizado
                let rms = 0;
                for (let i = 0; i < normalizedData.length; i++) {
                    rms += normalizedData[i] * normalizedData[i];
                }
                rms = Math.sqrt(rms / normalizedData.length);

                console.log('[CREPE Debug]', {
                    frequency: frequency.toFixed(1) + ' Hz',
                    confidence: (confidence * 100).toFixed(1) + '%',
                    gain: this.calibratedGain.toFixed(2) + 'x',
                    normRMS: rms.toFixed(3),
                    maxConfBin: Math.max(...Array.from(outputData)).toFixed(3)
                });
            }

            // 9. Validar rango vocal (65-1400 Hz)
            if (frequency < 65 || frequency > 1400 || !isFinite(frequency)) {
                return { frequency: 0, confidence: 0, midiNote: 0 };
            }

            return {
                frequency,
                confidence,
                midiNote: this.frequencyToMidi(frequency)
            };

        } catch (error) {
            console.error('[AudioPitchService] Error en detectPitch:', error);
            return { frequency: 0, confidence: 0, midiNote: 0 };
        }
    }

    /**
     * Resamplea audio a 16kHz
     */
    private resampleTo16kHz(audioData: Float32Array, originalSampleRate: number): Float32Array {
        if (originalSampleRate === this.CREPE_SAMPLE_RATE) {
            return audioData;
        }

        const ratio = originalSampleRate / this.CREPE_SAMPLE_RATE;
        const newLength = Math.floor(audioData.length / ratio);
        const result = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const t = srcIndex - srcIndexFloor;

            // Interpolación lineal
            const sample1 = audioData[srcIndexFloor] || 0;
            const sample2 = audioData[Math.min(srcIndexFloor + 1, audioData.length - 1)] || 0;
            result[i] = sample1 * (1 - t) + sample2 * t;
        }

        return result;
    }

    /**
     * Extrae ventana centrada de audio
     */
    private extractWindow(audioData: Float32Array, windowSize: number): Float32Array {
        const result = new Float32Array(windowSize);
        
        if (audioData.length >= windowSize) {
            // Tomar del centro
            const start = Math.floor((audioData.length - windowSize) / 2);
            result.set(audioData.slice(start, start + windowSize));
        } else {
            // Rellenar con ceros
            const start = Math.floor((windowSize - audioData.length) / 2);
            result.set(audioData, start);
        }

        return result;
    }

    /**
     * Aplica ventana de Hanning para reducir spectral leakage
     * Especialmente útil para frecuencias graves
     */
    private applyHanningWindow(audioData: Float32Array): Float32Array {
        const windowSize = audioData.length;
        const result = new Float32Array(windowSize);

        for (let i = 0; i < windowSize; i++) {
            const hannCoeff = 0.5 * (1 - Math.cos(2 * Math.PI * i / (windowSize - 1)));
            result[i] = audioData[i] * hannCoeff;
        }

        return result;
    }

    /**
     * Corrige errores de octava usando autocorrelación simple
     * CREPE a veces detecta armónicos (2x, 4x) en lugar de fundamental
     * 
     * Estrategia: Si la frecuencia es alta pero el audio suena grave,
     * verificar si f/2 o f/4 es más probable
     */
    private correctOctaveErrors(frequency: number, audioData: Float32Array): number {
        if (frequency < 150) {
            // Frecuencias graves raramente tienen errores de octava hacia arriba
            return frequency;
        }

        // Calcular periodo en samples para la frecuencia detectada
        const sampleRate = this.audioContext!.sampleRate;
        const period = sampleRate / frequency;

        // Verificar si periodos dobles (f/2) o cuádruples (f/4) tienen mejor correlación
        const correlationF = this.calculateAutocorrelation(audioData, period);
        const correlationF2 = this.calculateAutocorrelation(audioData, period * 2);
        const correlationF4 = this.calculateAutocorrelation(audioData, period * 4);

        // Si la correlación de f/2 o f/4 es significativamente mejor, usar esa
        // Thresholds aumentados (1.4 y 1.6) para ser menos agresivo en correcciones
        if (correlationF2 > correlationF * 1.4 && frequency / 2 >= 65) {
            // Octava abajo es más probable
            console.log('[CREPE] Corrección de octava: ', frequency.toFixed(1), '→', (frequency / 2).toFixed(1), 'Hz');
            return frequency / 2;
        }
        
        if (correlationF4 > correlationF * 1.6 && frequency / 4 >= 65) {
            // Dos octavas abajo es más probable
            console.log('[CREPE] Corrección de 2 octavas: ', frequency.toFixed(1), '→', (frequency / 4).toFixed(1), 'Hz');
            return frequency / 4;
        }

        return frequency;
    }

    /**
     * Calcula autocorrelación para un periodo dado
     */
    private calculateAutocorrelation(data: Float32Array, lag: number): number {
        const lagInt = Math.round(lag);
        if (lagInt >= data.length / 2) return 0;

        let sum = 0;
        let count = 0;
        
        for (let i = 0; i < data.length - lagInt; i++) {
            sum += data[i] * data[i + lagInt];
            count++;
        }

        return count > 0 ? sum / count : 0;
    }

    /**
     * Normaliza audio para que esté en rango [-1, 1]
     * CRÍTICO para CREPE: el modelo espera audio normalizado
     * Aplica ganancia calibrada para optimizar señal
     */
    private normalizeAudio(audioData: Float32Array): Float32Array {
        // Encontrar máximo absoluto
        let max = 0;
        for (let i = 0; i < audioData.length; i++) {
            const absValue = Math.abs(audioData[i]);
            if (absValue > max) {
                max = absValue;
            }
        }

        // Si el audio es silencio, retornar ceros
        // Threshold reducido a 0.0001 para capturar voces muy suaves
        if (max === 0 || max < 0.0001) {
            return new Float32Array(audioData.length);
        }

        // Normalizar con ganancia calibrada
        const result = new Float32Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
            // Aplicar ganancia y normalizar
            let value = (audioData[i] / max) * this.calibratedGain;
            // Clip a [-1, 1] para evitar saturación
            value = Math.max(-1, Math.min(1, value));
            result[i] = value;
        }

        return result;
    }

    /**
     * Interpreta la salida de CREPE (360 bins de probabilidad)
     * 
     * CREPE retorna 360 bins donde cada bin representa 20 cents
     * Frecuencia base: 32.70 Hz (C1)
     * Fórmula: f = f0 * 2^(cents/1200)
     */
    private interpretCrepeOutput(outputData: Float32Array | TypedArray): 
        { frequency: number; confidence: number } {
        
        // Encontrar bin con mayor probabilidad
        let maxConfidence = 0;
        let maxBin = 0;

        for (let i = 0; i < outputData.length; i++) {
            if (outputData[i] > maxConfidence) {
                maxConfidence = outputData[i];
                maxBin = i;
            }
        }

        // Convertir bin a frecuencia
        const cents = maxBin * this.CREPE_CENTS_PER_BIN;
        const frequency = this.CREPE_BASE_FREQ * Math.pow(2, cents / 1200);

        return {
            frequency,
            confidence: maxConfidence
        };
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
     * Calcula centroide espectral
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
        if (midi <= 0 || !isFinite(midi)) return '-';
        
        // Redondear MIDI a entero más cercano
        const midiInt = Math.round(midi);
        
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midiInt / 12) - 1;
        const noteIndex = midiInt % 12;
        const noteName = noteNames[noteIndex];
        
        // Validar que tenemos un nombre de nota válido
        if (!noteName) return '-';
        
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
        return this.isModelLoaded && !!this.analyser && !!this.timeDataArray && !!this.crepeModel;
    }

    /**
     * Limpia recursos
     */
    cleanup(): void {
        if (this.crepeModel) {
            this.crepeModel.dispose();
        }
        this.crepeModel = undefined;
        this.analyser = undefined;
        this.timeDataArray = undefined;
        this.frequencyDataArray = undefined;
        this.isModelLoaded = false;
    }

    /**
     * Alias para cleanup
     */
    destroy(): void {
        this.cleanup();
    }
}

// Type helper para output de CREPE
type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Uint8ClampedArray | Float32Array | Float64Array;
