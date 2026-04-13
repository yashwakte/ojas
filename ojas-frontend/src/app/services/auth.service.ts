import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthResponse, LoginRequest, RegisterRequest } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${environment.apiUrl}/auth`;
  private readonly TOKEN_KEY = 'ojas_token';
  private readonly USER_KEY = 'ojas_user';
  private readonly _user = signal<AuthResponse | null>(this.loadUser());

  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => !!this._user());

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  register(request: RegisterRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/register`, request);
  }

  login(request: LoginRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, request);
  }

  saveAuth(response: AuthResponse) {
    sessionStorage.setItem(this.TOKEN_KEY, response.token);
    sessionStorage.setItem(this.USER_KEY, JSON.stringify(response));
    this._user.set(response);
  }

  logout() {
    sessionStorage.removeItem(this.TOKEN_KEY);
    sessionStorage.removeItem(this.USER_KEY);
    this._user.set(null);
    this.router.navigate(['/']);
  }

  getToken(): string | null {
    const token = sessionStorage.getItem(this.TOKEN_KEY);
    if (token && this.isTokenExpired(token)) {
      this.logout();
      return null;
    }
    return token;
  }

  private isTokenExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 < Date.now();
    } catch {
      return true;
    }
  }

  private loadUser(): AuthResponse | null {
    const token = sessionStorage.getItem('ojas_token');
    if (token && this.isTokenExpired(token)) {
      sessionStorage.removeItem('ojas_token');
      sessionStorage.removeItem('ojas_user');
      return null;
    }
    const data = sessionStorage.getItem('ojas_user');
    return data ? JSON.parse(data) : null;
  }
}
