import { Routes } from '@angular/router';
import { PreparationComponent } from './pages/preparation/preparation';

export const CHECKUP_ROUTES: Routes = [
  { path: '', redirectTo: 'preparation', pathMatch: 'full' },
  { path: 'preparation', component: PreparationComponent },
  { path: 'calibration', loadComponent: () => import('./pages/calibration/calibration').then(m => m.CalibrationComponent) },
  { path: 'vocal-range', loadComponent: () => import('./pages/vocal-range/vocal-range').then(m => m.VocalRangeComponent) },
];