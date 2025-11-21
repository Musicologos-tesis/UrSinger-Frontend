import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment.development';
import { firstValueFrom } from 'rxjs';

export interface UserProfile {
  userId: string;
  name: string;
  email: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  weeklyTrainingFreq: number;
  profileId?: string;
}

export interface UpdateProfileData {
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  weeklyTrainingFreq: number;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private http = inject(HttpClient);

  async getProfile(userId: string): Promise<UserProfile> {
    console.log('[ProfileService] 📋 Obteniendo perfil para userId:', userId);
    return await firstValueFrom(
      this.http.get<UserProfile>(
        `${environment.API_BASE_URL}/profile/${userId}`
      )
    );
  }

  async updateProfile(userId: string, data: UpdateProfileData): Promise<UserProfile> {
    console.log('[ProfileService] ✏️ Actualizando perfil:', userId, data);
    return await firstValueFrom(
      this.http.put<UserProfile>(
        `${environment.API_BASE_URL}/profile/${userId}`,
        data
      )
    );
  }
}
