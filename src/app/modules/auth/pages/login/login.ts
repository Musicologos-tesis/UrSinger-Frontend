import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../../services/auth.service';
import { AuthHeaderComponent } from '../../components/auth-header/auth-header.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, AuthHeaderComponent],
  templateUrl: './login.html',
  styleUrls: ['./login.scss']
})
export class LoginComponent {
  email = signal<string>('');
  password = signal<string>('');
  isLoading = signal<boolean>(false);
  errorMessage = signal<string>('');

  constructor(
    private authService: AuthService,
    public router: Router
  ) {}

  onSubmit(): void {
    if (!this.email() || !this.password()) {
      this.errorMessage.set('Por favor completa todos los campos');
      return;
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.email())) {
      this.errorMessage.set('Por favor ingresa un correo electrónico válido');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    this.authService.login({
      email: this.email(),
      password: this.password()
    }).subscribe({
      next: async (response) => {
        // Esperar a que se obtenga el profile
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const profileId = localStorage.getItem('profile_id');
        
        if (profileId) {
          // Verificar si tiene un plan de entrenamiento activo
          const hasActivePlan = await this.authService.checkActiveTrainingPlan(profileId);
          
          this.isLoading.set(false);
          
          if (hasActivePlan) {
            // Si tiene plan activo, ir al dashboard de entrenamiento
            this.router.navigate(['/training/dashboard']);
          } else {
            // Si no tiene plan, ir al checkup
            this.router.navigate(['/checkup/preparation']);
          }
        } else {
          this.isLoading.set(false);
          this.router.navigate(['/checkup/preparation']);
        }
      },
      error: (error) => {
        this.isLoading.set(false);
        let message = 'Error al iniciar sesión. Intenta nuevamente.';
        
        if (error.status === 401) {
          message = 'Credenciales inválidas';
        } else if (error.error?.message) {
          // Traducir mensajes comunes del backend
          const backendMessage = error.error.message.toLowerCase();
          if (backendMessage.includes('email must be an email')) {
            message = 'El correo electrónico debe tener un formato válido';
          } else if (backendMessage.includes('invalid credentials')) {
            message = 'Credenciales inválidas';
          } else {
            message = error.error.message;
          }
        }
        
        this.errorMessage.set(message);
      }
    });
  }

  updateEmail(value: string): void {
    this.email.set(value);
  }

  updatePassword(value: string): void {
    this.password.set(value);
  }
}
