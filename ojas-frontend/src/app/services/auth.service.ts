import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthResponse, LoginRequest, RegisterRequest } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${environment.apiUrl}/auth`;
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

  ping() {
    // Fire-and-forget to wake up Render free-tier server on app load
    this.http.get(`${this.apiUrl}/ping`, { responseType: 'text' }).subscribe({ error: () => {} });
  }

  login(request: LoginRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, request);
  }

  saveAuth(response: AuthResponse) {
    localStorage.setItem(this.USER_KEY, JSON.stringify(response));
    this._user.set(response);
  }

  logout() {
    this.http.post(`${this.apiUrl}/logout`, {}, { responseType: 'text' }).subscribe({ error: () => {} });
    localStorage.removeItem(this.USER_KEY);
    this._user.set(null);
    this.router.navigate(['/']);
  }

  getToken(): string | null {
    return null;
  }

  private loadUser(): AuthResponse | null {
    const data = localStorage.getItem('ojas_user');
    return data ? JSON.parse(data) : null;
  }
}
