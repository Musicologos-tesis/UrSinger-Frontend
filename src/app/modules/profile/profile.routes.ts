import { Routes } from '@angular/router';

export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/profile/profile').then(m => m.ProfileComponent)
  }
];
