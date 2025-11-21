import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  weeklyTrainingFreq: number;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: {
    id: string;
    email: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface ProfileResponse {
  id: string;
  userId: string;
  weeklyTrainingFrequency: number;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorResponse {
  message: string;
  error: string;
  statusCode: number;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly TOKEN_KEY = 'access_token';
  private readonly USER_KEY = 'user_data';
  
  isAuthenticated = signal<boolean>(this.hasToken());

  constructor(
    private http: HttpClient,
    private router: Router
  ) {}

  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(
      `${environment.API_BASE_URL}/auth/login`,
      credentials
    ).pipe(
      tap(response => {
        this.storeAuthData(response);
        this.isAuthenticated.set(true);
        // Obtener y almacenar el profile ID
        this.getProfile(response.user.id).subscribe({
          next: (profile) => {
            localStorage.setItem('profile_id', profile.id);
          },
          error: (error) => {
            console.error('Error fetching profile:', error);
          }
        });
      })
    );
  }

  register(data: RegisterRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(
      `${environment.API_BASE_URL}/auth/register`,
      data
    );
  }

  getProfile(userId: string): Observable<ProfileResponse> {
    const token = this.getToken();
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });
    return this.http.get<ProfileResponse>(
      `${environment.API_BASE_URL}/profile/${userId}`,
      { headers }
    );
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem('profile_id');
    localStorage.removeItem('ursinger.checkup.sessionId');
    localStorage.removeItem('ursinger.metrics.partial');
    this.isAuthenticated.set(false);
    this.router.navigate(['/auth/login']);
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  getUser(): LoginResponse['user'] | null {
    const userData = localStorage.getItem(this.USER_KEY);
    return userData ? JSON.parse(userData) : null;
  }

  private storeAuthData(response: LoginResponse): void {
    localStorage.setItem(this.TOKEN_KEY, response.access_token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(response.user));
  }

  private hasToken(): boolean {
    return !!this.getToken();
  }

  async checkActiveTrainingPlan(profileId: string): Promise<boolean> {
    try {
      const token = this.getToken();
      const headers = new HttpHeaders({
        'Authorization': `Bearer ${token}`
      });
      await this.http.get(
        `${environment.API_BASE_URL}/training-plans/active/${profileId}`,
        { headers }
      ).toPromise();
      return true;
    } catch (error) {
      return false;
    }
  }
}
