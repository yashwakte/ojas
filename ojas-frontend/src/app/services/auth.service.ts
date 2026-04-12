import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthResponse, LoginRequest, RegisterRequest } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${environment.apiUrl}/auth`;
  private readonly _user = signal<AuthResponse | null>(this.loadUser());

  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => !!this._user());

  constructor(private http: HttpClient, private router: Router) {}

  register(request: RegisterRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/register`, request);
  }

  login(request: LoginRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, request);
  }

  saveAuth(response: AuthResponse) {
    localStorage.setItem('ojas_token', response.token);
    localStorage.setItem('ojas_user', JSON.stringify(response));
    this._user.set(response);
  }

  logout() {
    localStorage.removeItem('ojas_token');
    localStorage.removeItem('ojas_user');
    this._user.set(null);
    this.router.navigate(['/']);
  }

  getToken(): string | null {
    return localStorage.getItem('ojas_token');
  }

  private loadUser(): AuthResponse | null {
    const data = localStorage.getItem('ojas_user');
    return data ? JSON.parse(data) : null;
  }
}
