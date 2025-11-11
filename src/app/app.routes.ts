import { Routes } from '@angular/router';

export const routes: Routes = [
    { path: '', redirectTo: 'checkup', pathMatch: 'full' },
    {
        path: 'checkup',
        loadChildren: () =>
        import('./modules/checkup/checkup.routes').then(m => m.CHECKUP_ROUTES),
    },
    {
        path: 'learning',
        loadChildren: () =>
        import('./modules/learning/learning.routes').then(m => m.LEARNING_ROUTES),
    },
];
