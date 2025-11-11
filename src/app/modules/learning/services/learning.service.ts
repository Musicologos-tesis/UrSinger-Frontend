import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../environments/environment.development';
import { firstValueFrom } from 'rxjs';

import {
  VocalTechnique,
  VocalLesson,
  VocalExercise,
  StudentProgress,
  ExerciseAttempt,
  ExerciseAttemptResponse,
  CreateLessonDto,
  CreateExerciseDto,
  SubmitExerciseAttemptDto,
  ProgressStatus,
  DifficultyLevel
} from '../models';

@Injectable({
  providedIn: 'root'
})
export class LearningService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.API_BASE_URL}/learning`;

  // === Técnicas Vocales ===

  /**
   * Obtiene todas las técnicas vocales disponibles
   */
  async getTechniques(): Promise<VocalTechnique[]> {
    try {
      return await firstValueFrom(
        this.http.get<VocalTechnique[]>(`${this.apiUrl}/techniques`)
      );
    } catch (error) {
      console.error('Error al obtener técnicas:', error);
      throw error;
    }
  }

  /**
   * Obtiene detalles de una técnica específica
   */
  async getTechniqueDetails(techniqueId: string): Promise<VocalTechnique> {
    try {
      return await firstValueFrom(
        this.http.get<VocalTechnique>(`${this.apiUrl}/techniques/${techniqueId}`)
      );
    } catch (error) {
      console.error(`Error al obtener técnica ${techniqueId}:`, error);
      throw error;
    }
  }

  // === Lecciones ===

  /**
   * Obtiene lecciones, opcionalmente filtradas por técnica
   */
  async getLessons(techniqueId?: string): Promise<VocalLesson[]> {
    try {
      let params = new HttpParams();
      if (techniqueId) {
        params = params.set('techniqueId', techniqueId);
      }

      return await firstValueFrom(
        this.http.get<VocalLesson[]>(`${this.apiUrl}/lessons`, { params })
      );
    } catch (error) {
      console.error('Error al obtener lecciones:', error);
      throw error;
    }
  }

  /**
   * Obtiene detalles de una lección específica
   */
  async getLessonDetails(lessonId: string): Promise<VocalLesson> {
    try {
      return await firstValueFrom(
        this.http.get<VocalLesson>(`${this.apiUrl}/lessons/${lessonId}`)
      );
    } catch (error) {
      console.error(`Error al obtener lección ${lessonId}:`, error);
      throw error;
    }
  }

  /**
   * Crea una nueva lección
   */
  async createLesson(dto: CreateLessonDto): Promise<VocalLesson> {
    try {
      return await firstValueFrom(
        this.http.post<VocalLesson>(`${this.apiUrl}/lessons`, dto)
      );
    } catch (error) {
      console.error('Error al crear lección:', error);
      throw error;
    }
  }

  // === Ejercicios ===

  /**
   * Obtiene ejercicios, opcionalmente filtrados por técnica
   */
  async getExercises(techniqueId?: string): Promise<VocalExercise[]> {
    try {
      let params = new HttpParams();
      if (techniqueId) {
        params = params.set('techniqueId', techniqueId);
      }

      return await firstValueFrom(
        this.http.get<VocalExercise[]>(`${this.apiUrl}/exercises`, { params })
      );
    } catch (error) {
      console.error('Error al obtener ejercicios:', error);
      throw error;
    }
  }

  /**
   * Obtiene detalles de un ejercicio específico
   */
  async getExerciseDetails(exerciseId: string): Promise<VocalExercise> {
    try {
      return await firstValueFrom(
        this.http.get<VocalExercise>(`${this.apiUrl}/exercises/${exerciseId}`)
      );
    } catch (error) {
      console.error(`Error al obtener ejercicio ${exerciseId}:`, error);
      throw error;
    }
  }

  /**
   * Crea un nuevo ejercicio
   */
  async createExercise(dto: CreateExerciseDto): Promise<VocalExercise> {
    try {
      return await firstValueFrom(
        this.http.post<VocalExercise>(`${this.apiUrl}/exercises`, dto)
      );
    } catch (error) {
      console.error('Error al crear ejercicio:', error);
      throw error;
    }
  }

  // === Progreso del Estudiante ===

  /**
   * Obtiene el progreso de un usuario, opcionalmente filtrado por técnica
   */
  async getUserProgress(
    userId: string,
    techniqueId?: string
  ): Promise<StudentProgress[]> {
    try {
      let params = new HttpParams();
      if (techniqueId) {
        params = params.set('techniqueId', techniqueId);
      }

      return await firstValueFrom(
        this.http.get<StudentProgress[]>(
          `${this.apiUrl}/progress/${userId}`,
          { params }
        )
      );
    } catch (error) {
      console.error(`Error al obtener progreso del usuario ${userId}:`, error);
      throw error;
    }
  }

  // === Intentos de Ejercicios ===

  /**
   * Envía un intento de ejercicio (grabación + métricas)
   */
  async submitAttempt(
    dto: SubmitExerciseAttemptDto
  ): Promise<ExerciseAttemptResponse> {
    try {
      return await firstValueFrom(
        this.http.post<ExerciseAttemptResponse>(`${this.apiUrl}/attempts`, dto)
      );
    } catch (error) {
      console.error('Error al enviar intento:', error);
      throw error;
    }
  }

  /**
   * Obtiene los intentos de un usuario, opcionalmente filtrados por ejercicio
   */
  async getUserAttempts(
    userId: string,
    exerciseId?: string
  ): Promise<ExerciseAttempt[]> {
    try {
      let params = new HttpParams();
      if (exerciseId) {
        params = params.set('exerciseId', exerciseId);
      }

      return await firstValueFrom(
        this.http.get<ExerciseAttempt[]>(
          `${this.apiUrl}/attempts/${userId}`,
          { params }
        )
      );
    } catch (error) {
      console.error(`Error al obtener intentos del usuario ${userId}:`, error);
      throw error;
    }
  }
}
