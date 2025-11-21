import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment.development';
import { firstValueFrom } from 'rxjs';

export interface Exercise {
  planExerciseId: string;
  exerciseLevelId: number;
  exerciseId: number;
  exerciseName: string;
  groupNumber: number;
  groupName: string;
  level: number;
  description: string;
  instructions: string;
  videoUrl: string | null;
  cvtDescription: string | null;
  evmDescription: string | null;
  completionCount: number;
  completedDates: string[];
  isCompletedThisWeek: boolean;
}

export interface ExerciseDetail {
  planExerciseId: string;
  exerciseLevelId: number;
  exerciseId: number;
  exerciseName: string;
  groupNumber: number;
  groupName: string;
  level: number;
  description: string;
  instructions: string;
  videoUrl: string | null;
  cvtDescription: string | null;
  evmDescription: string | null;
  completionCount: number;
  completedDates: string[];
  isCompletedThisWeek: boolean;
}

export interface DayExercises {
  day: number;
  dayName: string;
  exercises: Exercise[];
}

export interface ActiveTrainingPlan {
  planId: string;
  frequency: number;
  focusGroups: string[];
  startDate: string;
  endDate: string;
  currentWeek: number;
  completedThisWeek: number;
  totalExercises: number;
  weekPlan: DayExercises[];
}

@Injectable({ providedIn: 'root' })
export class TrainingService {
  private http = inject(HttpClient);

  async getActivePlan(profileId: string): Promise<ActiveTrainingPlan> {
    console.log('[TrainingService] 📚 Obteniendo plan activo para profileId:', profileId);
    return await firstValueFrom(
      this.http.get<ActiveTrainingPlan>(
        `${environment.API_BASE_URL}/training-plans/active/${profileId}`
      )
    );
  }

  async getExerciseDetail(planExerciseId: string): Promise<ExerciseDetail> {
    console.log('[TrainingService] 🎯 Obteniendo detalle de ejercicio:', planExerciseId);
    return await firstValueFrom(
      this.http.get<ExerciseDetail>(
        `${environment.API_BASE_URL}/training-plans/exercise/${planExerciseId}`
      )
    );
  }

  async completeExercise(planExerciseId: string): Promise<void> {
    console.log('[TrainingService] ✅ Marcando ejercicio como completado:', planExerciseId);
    await firstValueFrom(
      this.http.put(
        `${environment.API_BASE_URL}/training-plans/exercise/complete`,
        { planExerciseId }
      )
    );
  }
}
