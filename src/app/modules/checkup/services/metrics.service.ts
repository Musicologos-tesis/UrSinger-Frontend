import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment.development';
import { firstValueFrom } from 'rxjs';

/**
 * Estructura completa de métricas que se envía a /metrics/evaluate
 */
export interface EvaluateMetricsPayload {
  profileId: string;
  sessionId: string;
  gender: 'M' | 'F';
  meanRmsDb: number;
  rmsConsistency: number;
  dynamicRangeDb: number;
  durationSec: number;
  precisionCents: number;
  stabilityCents: number;
  rangeMinMidi: number;
  rangeMaxMidi: number;
  rangeSpanSemitones: number;
  attackLatencyMs: number;
}

/**
 * Métricas parciales que vienen de cada ejercicio
 */
export interface PartialMetrics {
  // Rango vocal
  rangeMinMidi?: number;
  rangeMaxMidi?: number;
  rangeSpanSemitones?: number;
  
  // Estabilidad
  precisionCents?: number;
  stabilityCents?: number;
  attackLatencyMs?: number;
  
  // Ambos
  meanRmsDb?: number;
  rmsConsistency?: number;
  dynamicRangeDb?: number;
  durationSec?: number;
}

/**
 * Respuesta del backend al consultar /metrics/{sessionId} para calibración
 */
export interface CalibrationMetrics {
  sessionId: string;
  noiseFloorDbfs: number;
  snrDb: number;
  sampleRate?: number;
  deviceIdHash?: string;
}

/**
 * Respuesta completa del backend al consultar /metrics/{sessionId}
 */
export interface FullMetrics {
  id: string;
  profileId: string;
  sessionId: string;
  meanRmsDb: number;
  rmsConsistency: number;
  dynamicRangeDb: number;
  durationSec: number;
  precisionCents: number;
  stabilityCents: number;
  rangeMinMidi: number;
  rangeMaxMidi: number;
  rangeSpanSemitones: number;
  attackLatencyMs: number;
  weaknessesDetected: string[];
  totalWeaknesses: number;
  confidenceScores: Record<string, number>;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class MetricsService {
  private http = inject(HttpClient);
  
  private readonly STORAGE_KEY = 'ursinger.metrics.partial';

  /**
   * Guarda métricas parciales en localStorage
   */
  savePartialMetrics(source: 'range' | 'stability', metrics: PartialMetrics): void {
    const stored = this.getStoredMetrics();
    
    if (source === 'range') {
      // Métricas exclusivas de rango vocal
      stored.rangeMinMidi = metrics.rangeMinMidi;
      stored.rangeMaxMidi = metrics.rangeMaxMidi;
      stored.rangeSpanSemitones = metrics.rangeSpanSemitones;
      
      // Métricas de confirmaciones (vienen de range)
      if (metrics.precisionCents !== undefined) stored.precisionCents = metrics.precisionCents;
      if (metrics.attackLatencyMs !== undefined) stored.attackLatencyMs = metrics.attackLatencyMs;
      
      // Métricas compartidas (RMS, duración)
      if (metrics.meanRmsDb !== undefined) stored.meanRmsDb = metrics.meanRmsDb;
      if (metrics.rmsConsistency !== undefined) stored.rmsConsistency = metrics.rmsConsistency;
      if (metrics.dynamicRangeDb !== undefined) stored.dynamicRangeDb = metrics.dynamicRangeDb;
      if (metrics.durationSec !== undefined) stored.durationSec = metrics.durationSec;
    } else if (source === 'stability') {
      // Métrica exclusiva de estabilidad
      if (metrics.stabilityCents !== undefined) stored.stabilityCents = metrics.stabilityCents;
      
      // Métricas compartidas (pueden promediar con las de rango)
      if (metrics.meanRmsDb !== undefined) {
        // Promediar si ya existe de rango
        stored.meanRmsDb = stored.meanRmsDb !== undefined 
          ? (stored.meanRmsDb + metrics.meanRmsDb) / 2 
          : metrics.meanRmsDb;
      }
      if (metrics.rmsConsistency !== undefined) {
        stored.rmsConsistency = stored.rmsConsistency !== undefined
          ? (stored.rmsConsistency + metrics.rmsConsistency) / 2
          : metrics.rmsConsistency;
      }
      if (metrics.dynamicRangeDb !== undefined) {
        stored.dynamicRangeDb = stored.dynamicRangeDb !== undefined
          ? (stored.dynamicRangeDb + metrics.dynamicRangeDb) / 2
          : metrics.dynamicRangeDb;
      }
      if (metrics.durationSec !== undefined) {
        stored.durationSec = stored.durationSec !== undefined
          ? (stored.durationSec + metrics.durationSec) / 2
          : metrics.durationSec;
      }
    }
    
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(stored));
  }

  /**
   * Obtiene métricas parciales guardadas
   */
  private getStoredMetrics(): PartialMetrics {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (!stored) return {};
    
    try {
      return JSON.parse(stored);
    } catch {
      return {};
    }
  }

  /**
   * Obtiene métricas de calibración desde el backend
   */
  async getCalibrationMetrics(sessionId: string): Promise<CalibrationMetrics> {
    return await firstValueFrom(
      this.http.get<CalibrationMetrics>(
        `${environment.API_BASE_URL}/metrics/${sessionId}`
      )
    );
  }

  /**
   * Obtiene métricas completas desde el backend
   */
  async getFullMetrics(sessionId: string): Promise<FullMetrics> {
    console.log('[MetricsService] 📊 Obteniendo métricas completas para sessionId:', sessionId);
    return await firstValueFrom(
      this.http.get<FullMetrics>(
        `${environment.API_BASE_URL}/metrics/${sessionId}`
      )
    );
  }

  /**
   * Envía todas las métricas combinadas a /metrics/evaluate
   */
  async evaluateMetrics(): Promise<any> {
    const profileId = localStorage.getItem('profile_id');
    const sessionId = localStorage.getItem('ursinger.checkup.sessionId');
    const userData = localStorage.getItem('user_data');
    
    if (!profileId || !sessionId) {
      throw new Error('Faltan profileId o sessionId. Asegúrate de haber completado login y calibración.');
    }

    // Obtener gender del usuario (solo 'M' o 'F')
    let gender: 'M' | 'F' = 'M'; // Default a masculino si no se especifica
    if (userData) {
      try {
        const user = JSON.parse(userData);
        if (user.gender === 'male') gender = 'M';
        else if (user.gender === 'female') gender = 'F';
        // Si es otro valor, se mantiene 'M' como default
      } catch {
        // Ignorar errores de parseo, usar default 'M'
      }
    }

    // Obtener métricas parciales guardadas
    const partial = this.getStoredMetrics();

    // TEMPORAL: Comentar métricas reales y usar datos hardcodeados para testing
    const payload: EvaluateMetricsPayload = {
       profileId,
       sessionId,
       gender,
       meanRmsDb: partial.meanRmsDb ?? -25.5,
       rmsConsistency: partial.rmsConsistency ?? 0.8,
       dynamicRangeDb: partial.dynamicRangeDb ?? 18.2,
       durationSec: partial.durationSec ?? 4.5,
       precisionCents: partial.precisionCents ?? 12.5,
       stabilityCents: partial.stabilityCents ?? 8.3,
       rangeMinMidi: partial.rangeMinMidi ?? 48,
       rangeMaxMidi: partial.rangeMaxMidi ?? 72,
       rangeSpanSemitones: partial.rangeSpanSemitones ?? 24,
       attackLatencyMs: partial.attackLatencyMs ?? 150
     };

    // HARDCODEADO para testing
    /*
    const payload: EvaluateMetricsPayload = {
      profileId,
      sessionId,
      gender: 'M',
      meanRmsDb: -25.5,
      rmsConsistency: 2.3,
      dynamicRangeDb: 18.2,
      durationSec: 4.5,
      precisionCents: 12.5,
      stabilityCents: 8.3,
      rangeMinMidi: 48,
      rangeMaxMidi: 72,
      rangeSpanSemitones: 24,
      attackLatencyMs: 150
    };*/

    console.log('[MetricsService] 📤 Enviando a /metrics/evaluate:', {
      url: `${environment.API_BASE_URL}/metrics/evaluate`,
      payload
    });

    // Enviar a backend
    const response = await firstValueFrom(
      this.http.post(
        `${environment.API_BASE_URL}/metrics/evaluate`,
        payload
      )
    );
    
    console.log('[MetricsService] ✅ Respuesta recibida:', response);

    // Limpiar métricas parciales después de enviar
    this.clearPartialMetrics();

    return response;
  }

  /**
   * Genera el plan de entrenamiento personalizado
   */
  async generateTrainingPlan(): Promise<any> {
    const profileId = localStorage.getItem('profile_id');
    
    if (!profileId) {
      throw new Error('Falta profileId. Asegúrate de haber completado login.');
    }

    console.log('[MetricsService] 🏋️ Generando plan de entrenamiento...');

    const response = await firstValueFrom(
      this.http.post(
        `${environment.API_BASE_URL}/training-plans/generate`,
        { profileId }
      )
    );
    
    console.log('[MetricsService] ✅ Plan generado:', response);
    return response;
  }

  /**
   * Limpia métricas parciales del localStorage
   */
  clearPartialMetrics(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  /**
   * Obtiene un resumen de las métricas guardadas (para debugging o UI)
   */
  getMetricsSummary(): PartialMetrics {
    return this.getStoredMetrics();
  }
}
