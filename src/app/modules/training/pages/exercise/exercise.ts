import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';
import { TrainingService, ExerciseDetail } from '../../services/training.service';
import { AuthService } from '../../../../services/auth.service';

@Component({
  selector: 'app-exercise',
  standalone: true,
  imports: [CommonModule, AuthHeaderComponent],
  templateUrl: './exercise.html',
  styleUrl: './exercise.scss',
})
export class ExerciseComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private trainingService = inject(TrainingService);
  private authService = inject(AuthService);

  exercise = signal<ExerciseDetail | null>(null);
  isLoading = signal(true);
  error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const planExerciseId = this.route.snapshot.paramMap.get('id');
    
    if (!planExerciseId) {
      this.error.set('No se encontró el ID del ejercicio');
      this.isLoading.set(false);
      return;
    }

    try {
      const exerciseData = await this.trainingService.getExerciseDetail(planExerciseId);
      this.exercise.set(exerciseData);
    } catch (err: any) {
      console.error('[Exercise] Error al cargar ejercicio:', err);
      this.error.set('No se pudo cargar el ejercicio');
    } finally {
      this.isLoading.set(false);
    }
  }

  getDifficultyLabel(level: number): string {
    return `Nivel ${level}`;
  }

  startChallenge(): void {
    console.log('[Exercise] Iniciar desafío:', this.exercise()?.planExerciseId);
    const exerciseId = this.exercise()?.planExerciseId;
    if (exerciseId) {
      this.router.navigate(['/training/practice', exerciseId]);
    }
  }

  goToTraining(): void {
    this.router.navigate(['/training/dashboard']);
  }

  goToCheckup(): void {
    this.router.navigate(['/checkup/preparation']);
  }

  goToProfile(): void {
    this.router.navigate(['/profile']);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }
}
