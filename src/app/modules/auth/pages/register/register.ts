import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../../services/auth.service';
import { AuthHeaderComponent } from '../../components/auth-header/auth-header.component';

interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  weeklyTrainingFreq: number;
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, AuthHeaderComponent],
  templateUrl: './register.html',
  styleUrls: ['./register.scss']
})
export class RegisterComponent {
  email = signal<string>('');
  password = signal<string>('');
  name = signal<string>('');
  age = signal<number | null>(null);
  gender = signal<'male' | 'female' | 'other'>('male');
  isLoading = signal<boolean>(false);
  errorMessage = signal<string>('');

  constructor(
    private authService: AuthService,
    public router: Router
  ) {}

  onSubmit(): void {
    if (!this.email() || !this.password() || !this.name() || !this.age()) {
      this.errorMessage.set('Por favor completa todos los campos');
      return;
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.email())) {
      this.errorMessage.set('Por favor ingresa un correo electrónico válido');
      return;
    }

    if (this.age()! < 1 || this.age()! > 120) {
      this.errorMessage.set('Por favor ingresa una edad válida');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    const registerData: RegisterRequest = {
      email: this.email(),
      password: this.password(),
      name: this.name(),
      age: this.age()!,
      gender: this.gender(),
      weeklyTrainingFreq: 3
    };

    this.authService.register(registerData).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.router.navigate(['/auth/login']);
      },
      error: (error: any) => {
        this.isLoading.set(false);
        let message = 'Error al registrarse. Intenta nuevamente.';
        
        if (error.status === 409) {
          message = 'Este correo electrónico ya está registrado';
        } else if (error.status === 400 && error.error?.message) {
          // Traducir mensajes comunes del backend
          const backendMessage = error.error.message;
          if (Array.isArray(backendMessage)) {
            // Si es un array de errores de validación
            const translatedErrors = backendMessage.map((msg: string) => {
              if (msg.includes('email must be an email')) {
                return 'El correo electrónico debe tener un formato válido';
              }
              if (msg.includes('password')) {
                return 'La contraseña debe tener al menos 8 caracteres';
              }
              if (msg.includes('age')) {
                return 'La edad debe ser un número válido';
              }
              return msg;
            });
            message = translatedErrors.join('. ');
          } else if (typeof backendMessage === 'string') {
            if (backendMessage.toLowerCase().includes('email must be an email')) {
              message = 'El correo electrónico debe tener un formato válido';
            } else {
              message = backendMessage;
            }
          }
        } else if (error.error?.message) {
          message = error.error.message;
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

  updateName(value: string): void {
    this.name.set(value);
  }

  updateAge(value: string): void {
    const age = parseInt(value, 10);
    this.age.set(isNaN(age) ? null : age);
  }

  updateGender(value: string): void {
    this.gender.set(value as 'male' | 'female' | 'other');
  }
}
