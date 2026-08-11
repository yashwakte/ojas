import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import {
  AuthResponse,
  CreateStaffRequest,
  LoginRequest,
  RegisterRequest,
  StaffUserResponse,
  UserRole,
} from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${environment.apiUrl}/auth`;
  private readonly USER_KEY = 'ojas_user';
  private readonly _user = signal<AuthResponse | null>(this.loadUser());

  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => !!this._user());
  readonly role = computed(() => this._user()?.role ?? 'customer');
  readonly isAdmin = computed(() => this.role() === 'admin');
  readonly isDelivery = computed(() => this.role() === 'delivery');

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

  createStaff(request: CreateStaffRequest) {
    return this.http.post<StaffUserResponse>(`${this.apiUrl}/staff`, request);
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

  getDefaultRouteForRole(role: UserRole = this.role()): string {
    if (role === 'admin') return '/admin/orders';
    if (role === 'delivery') return '/delivery/orders';
    return '/';
  }

  // Backend and frontend are on different domains, so document.cookie can't read the
  // CSRF cookie set by the API - it's delivered in the login/register response body instead.
  getCsrfToken(): string | null {
    return this._user()?.csrfToken ?? null;
  }

  getToken(): string | null {
    return null;
  }

  updateUserInfo(updates: Partial<Pick<AuthResponse, 'fullName' | 'email' | 'phone'>>): void {
    const current = this._user();
    if (current) {
      const updated = { ...current, ...updates };
      localStorage.setItem(this.USER_KEY, JSON.stringify(updated));
      this._user.set(updated);
    }
  }

  private loadUser(): AuthResponse | null {
    const data = localStorage.getItem('ojas_user');
    return data ? JSON.parse(data) : null;
  }
}
