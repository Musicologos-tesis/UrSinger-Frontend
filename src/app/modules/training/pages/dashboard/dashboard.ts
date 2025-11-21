import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TrainingService, ActiveTrainingPlan, Exercise } from '../../services/training.service';
import { AuthService } from '../../../../services/auth.service';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';

@Component({
  selector: 'app-training-dashboard',
  standalone: true,
  imports: [CommonModule, AuthHeaderComponent],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class TrainingDashboardComponent implements OnInit {
  private router = inject(Router);
  private trainingService = inject(TrainingService);
  private authService = inject(AuthService);

  trainingPlan: ActiveTrainingPlan | null = null;
  isLoading = false;
  error: string | null = null;

  async ngOnInit(): Promise<void> {
    await this.loadActivePlan();
  }

  async loadActivePlan(): Promise<void> {
    try {
      this.isLoading = true;
      this.error = null;

      const profileId = localStorage.getItem('profile_id');
      if (!profileId) {
        this.error = 'No se encontró el perfil del usuario';
        return;
      }

      this.trainingPlan = await this.trainingService.getActivePlan(profileId);
    } catch (error: any) {
      console.error('[TrainingDashboard] Error al cargar plan:', error);
      this.error = 'No se pudo cargar el plan de entrenamiento';
    } finally {
      this.isLoading = false;
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  getProgressPercentage(): number {
    if (!this.trainingPlan) return 0;
    return Math.round((this.trainingPlan.completedThisWeek / this.trainingPlan.totalExercises) * 100);
  }

  canStartExercise(exercise: Exercise, dayExercises: Exercise[]): boolean {
    // El primer ejercicio siempre está disponible
    const exerciseIndex = dayExercises.indexOf(exercise);
    if (exerciseIndex === 0) return true;

    // Los demás ejercicios requieren que el anterior esté completado
    const previousExercise = dayExercises[exerciseIndex - 1];
    return previousExercise.isCompletedThisWeek;
  }

  startExercise(exercise: Exercise): void {
    if (!this.canStartExercise(exercise, this.getExercisesForDay(exercise))) {
      return;
    }
    console.log('[TrainingDashboard] Iniciando ejercicio:', exercise.exerciseName);
    // TODO: Navegar a la vista del ejercicio
  }

  private getExercisesForDay(exercise: Exercise): Exercise[] {
    if (!this.trainingPlan) return [];
    const day = this.trainingPlan.weekPlan.find(d =>
      d.exercises.some(e => e.planExerciseId === exercise.planExerciseId)
    );
    return day?.exercises || [];
  }

  goToCheckup(): void {
    this.router.navigate(['/checkup/preparation']);
  }

  goToProfile(): void {
    // TODO: Implementar navegación a perfil
    console.log('[TrainingDashboard] Ir a perfil');
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }
}
