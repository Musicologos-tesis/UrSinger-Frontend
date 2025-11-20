import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
    { path: '', redirectTo: 'auth', pathMatch: 'full' },
    {
        path: 'auth',
        loadChildren: () =>
        import('./modules/auth/auth.routes').then(m => m.AUTH_ROUTES),
    },
    {
        path: 'checkup',
        loadChildren: () =>
        import('./modules/checkup/checkup.routes').then(m => m.CHECKUP_ROUTES),
        canActivate: [authGuard],
    },
];
