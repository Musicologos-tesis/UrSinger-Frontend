import { Routes } from '@angular/router';

export const TRAINING_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard/dashboard').then(m => m.TrainingDashboardComponent),
  },
  {
    path: 'exercise/:id',
    loadComponent: () =>
      import('./pages/exercise/exercise').then(m => m.ExerciseComponent),
  },
  {
    path: 'practice/:id',
    loadComponent: () =>
      import('./pages/practice/practice').then(m => m.PracticeComponent),
  },
];
