import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ProfileService, UserProfile, UpdateProfileData } from '../../services/profile.service';
import { AuthService } from '../../../../services/auth.service';
import { AuthHeaderComponent } from '../../../auth/components/auth-header/auth-header.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AuthHeaderComponent],
  templateUrl: './profile.html',
  styleUrl: './profile.scss'
})
export class ProfileComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private profileService = inject(ProfileService);
  private authService = inject(AuthService);

  profileForm!: FormGroup;
  isLoading = signal(false);
  isSaving = signal(false);
  successMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);
  userProfile = signal<UserProfile | null>(null);

  ngOnInit(): void {
    this.initForm();
    this.loadProfile();
  }

  private initForm(): void {
    this.profileForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      age: [null, [Validators.required, Validators.min(10), Validators.max(100)]],
      gender: ['', Validators.required]
    });
  }

  private async loadProfile(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      // Obtener usuario del localStorage
      const userDataStr = localStorage.getItem('user_data');
      if (!userDataStr) {
        throw new Error('No se encontró la sesión del usuario');
      }

      const userData = JSON.parse(userDataStr);
      const userId = userData.id;

      if (!userId) {
        throw new Error('No se encontró el ID de usuario');
      }

      const profile = await this.profileService.getProfile(userId);
      this.userProfile.set(profile);

      // Cargar datos en el formulario
      this.profileForm.patchValue({
        name: profile.name,
        age: profile.age,
        gender: profile.gender
      });

      console.log('[Profile] Perfil cargado:', profile);
    } catch (error: any) {
      console.error('[Profile] Error al cargar perfil:', error);
      this.errorMessage.set(error.message || 'Error al cargar el perfil');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onSubmit(): Promise<void> {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    this.successMessage.set(null);
    this.errorMessage.set(null);

    try {
      // Obtener usuario del localStorage
      const userDataStr = localStorage.getItem('user_data');
      if (!userDataStr) {
        throw new Error('No se encontró la sesión del usuario');
      }

      const userData = JSON.parse(userDataStr);
      const userId = userData.id;

      if (!userId) {
        throw new Error('No se encontró el ID de usuario');
      }

      const updateData: UpdateProfileData = {
        name: this.profileForm.value.name,
        age: Number(this.profileForm.value.age),
        gender: this.profileForm.value.gender,
        weeklyTrainingFreq: 3 // Fijo en 3
      };

      const updatedProfile = await this.profileService.updateProfile(userId, updateData);
      this.userProfile.set(updatedProfile);
      
      this.successMessage.set('✓ Perfil actualizado correctamente');
      
      // Limpiar mensaje después de 3 segundos
      setTimeout(() => {
        this.successMessage.set(null);
      }, 3000);

      console.log('[Profile] Perfil actualizado:', updatedProfile);
    } catch (error: any) {
      console.error('[Profile] Error al actualizar perfil:', error);
      this.errorMessage.set(error.message || 'Error al actualizar el perfil');
    } finally {
      this.isSaving.set(false);
    }
  }

  goToTraining(): void {
    this.router.navigate(['/training/dashboard']);
  }

  goToCheckup(): void {
    this.router.navigate(['/checkup/preparation']);
  }

  goToProfile(): void {
    // Ya estamos aquí
  }

  async logout(): Promise<void> {
    await this.authService.logout();
    this.router.navigate(['/auth/login']);
  }

  // Getters para validación del formulario
  get nameError(): string | null {
    const control = this.profileForm.get('name');
    if (control?.hasError('required') && control?.touched) {
      return 'El nombre es requerido';
    }
    if (control?.hasError('minlength') && control?.touched) {
      return 'El nombre debe tener al menos 2 caracteres';
    }
    return null;
  }

  get ageError(): string | null {
    const control = this.profileForm.get('age');
    if (control?.hasError('required') && control?.touched) {
      return 'La edad es requerida';
    }
    if (control?.hasError('min') && control?.touched) {
      return 'La edad mínima es 10 años';
    }
    if (control?.hasError('max') && control?.touched) {
      return 'La edad máxima es 100 años';
    }
    return null;
  }

  get genderError(): string | null {
    const control = this.profileForm.get('gender');
    if (control?.hasError('required') && control?.touched) {
      return 'El género es requerido';
    }
    return null;
  }
}
