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
  ) {
    // Remove legacy shared-cart keys that were not scoped to a user
    localStorage.removeItem('ojas_cart');
    localStorage.removeItem('ojas_checkout');
  }

  register(request: RegisterRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/register`, request);
  }

  checkEmail(email: string) {
    return this.http.get<{ exists: boolean }>(`${this.apiUrl}/check-email`, { params: { email } });
  }

  checkPhone(phone: string) {
    return this.http.get<{ exists: boolean }>(`${this.apiUrl}/check-phone`, { params: { phone } });
  }

  login(request: LoginRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, request);
  }

  saveAuth(response: AuthResponse) {
    localStorage.setItem(this.TOKEN_KEY, response.token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(response));
    this._user.set(response);
  }

  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this._user.set(null);
    this.router.navigate(['/']);
  }

  getToken(): string | null {
    const token = localStorage.getItem(this.TOKEN_KEY);
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
    const token = localStorage.getItem('ojas_token');
    if (token && this.isTokenExpired(token)) {
      localStorage.removeItem('ojas_token');
      localStorage.removeItem('ojas_user');
      return null;
    }
    const data = localStorage.getItem('ojas_user');
    return data ? JSON.parse(data) : null;
  }
}
