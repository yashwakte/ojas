import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, shareReplay, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AcceptInviteRequest,
  AuthResponse,
  CreateStaffRequest,
  CreateStaffResponse,
  InvitePreviewResponse,
  ResendInviteResponse,
  DeviceOtpRequest,
  DeviceOtpResponse,
  EnrollDeviceRequest,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginRequest,
  PhoneLoginRequest,
  PhoneLoginResponse,
  PhoneLoginVerifyRequest,
  PreApprovedEnrollRequest,
  ResetPasswordRequest,
  RegisterPendingResponse,
  RegisterRequest,
  ResendEmailOtpRequest,
  ResendEmailOtpResponse,
  StaffDeviceResponse,
  StaffUserResponse,
  UserRole,
  VerifyEmailOtpRequest,
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
    return this.http.post<RegisterPendingResponse>(`${this.apiUrl}/register`, request);
  }

  verifyEmailOtp(request: VerifyEmailOtpRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/verify-email-otp`, request);
  }

  resendEmailOtp(request: ResendEmailOtpRequest) {
    return this.http.post<ResendEmailOtpResponse>(`${this.apiUrl}/resend-email-otp`, request);
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

  // Fire-and-forget on app load: if the session cookie has expired server-side,
  // this 401s and the auth interceptor logs the stale client-side state out
  // immediately instead of waiting for the user to trigger it themselves.
  validateSession() {
    return this.http.get(`${this.apiUrl}/session`, { responseType: 'text' });
  }

  login(request: LoginRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, request);
  }

  forgotPassword(request: ForgotPasswordRequest) {
    return this.http.post<ForgotPasswordResponse>(`${this.apiUrl}/forgot-password`, request);
  }

  // Deliberately issues no session - the user signs in again afterwards, which for staff still
  // means passing the device check.
  resetPassword(request: ResetPasswordRequest) {
    return this.http.post<{ message: string }>(`${this.apiUrl}/reset-password`, request);
  }

  // Customer-only: sign in with a phone number instead of email+password. 503s until MSG91 is
  // configured server-side.
  sendPhoneLoginOtp(request: PhoneLoginRequest) {
    return this.http.post<PhoneLoginResponse>(`${this.apiUrl}/phone-login/send-otp`, request);
  }

  verifyPhoneLogin(request: PhoneLoginVerifyRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/phone-login/verify`, request);
  }

  // Staff accounts are restricted to a single device. When login comes back 403 with
  // needsDeviceEnrollment, these two calls move the binding to the browser making them -
  // which also signs the previously bound device out.
  sendDeviceOtp(request: DeviceOtpRequest) {
    return this.http.post<DeviceOtpResponse>(`${this.apiUrl}/device/send-otp`, request);
  }

  enrollDevice(request: EnrollDeviceRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/device/enroll`, request);
  }

  // Redeems a standing admin approval instead of a code - see PreApprovedEnrollRequest.
  enrollPreApprovedDevice(request: PreApprovedEnrollRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/device/enroll-preapproved`, request);
  }

  getStaffDevices(userId: string) {
    return this.http.get<StaffDeviceResponse[]>(`${this.apiUrl}/staff/${userId}/devices`);
  }

  revokeStaffDevice(userId: string) {
    return this.http.delete<void>(`${this.apiUrl}/staff/${userId}/devices`);
  }

  // Lets this staff member's next device enroll on password alone, with no OTP email - the
  // break-glass path for when email delivery itself is down.
  approveNextDevice(userId: string) {
    return this.http.post<{ message: string; expiresAt: string }>(
      `${this.apiUrl}/staff/${userId}/approve-next-device`,
      {},
    );
  }

  // Called by the auth interceptor when a request 401s because the short-lived access token
  // expired - exchanges the (much longer-lived, HttpOnly) refresh cookie for a fresh one.
  refresh() {
    return this.http.post<AuthResponse>(`${this.apiUrl}/refresh`, {});
  }

  private refreshInFlight$: Observable<AuthResponse> | null = null;

  /** Single-flight wrapper around refresh() - if several requests 401 around the same moment
   * (e.g. a page firing multiple authenticated calls right as the access token expires), they
   * share one in-flight /refresh call instead of each firing their own. */
  refreshOnce(): Observable<AuthResponse> {
    if (!this.refreshInFlight$) {
      this.refreshInFlight$ = this.refresh().pipe(
        tap((res) => this.saveAuth(res)),
        catchError((err) => {
          this.logout();
          return throwError(() => err);
        }),
        finalize(() => {
          this.refreshInFlight$ = null;
        }),
        shareReplay(1),
      );
    }
    return this.refreshInFlight$;
  }

  createStaff(request: CreateStaffRequest) {
    return this.http.post<CreateStaffResponse>(`${this.apiUrl}/staff`, request);
  }

  resendStaffInvite(userId: string) {
    return this.http.post<ResendInviteResponse>(`${this.apiUrl}/staff/${userId}/invite`, {});
  }

  // Unauthenticated - the invite token is the credential.
  getInvite(token: string) {
    return this.http.get<InvitePreviewResponse>(`${this.apiUrl}/invite`, { params: { token } });
  }

  acceptInvite(request: AcceptInviteRequest) {
    return this.http.post<AuthResponse>(`${this.apiUrl}/accept-invite`, request);
  }

  saveAuth(response: AuthResponse) {
    localStorage.setItem(this.USER_KEY, JSON.stringify(response));
    this._user.set(response);
  }

  logout() {
    this.http.post(`${this.apiUrl}/logout`, {}, { responseType: 'text' }).subscribe({ error: () => {} });
    localStorage.removeItem(this.USER_KEY);
    this._user.set(null);
    this.router.navigate(['/login']);
  }

  getDefaultRouteForRole(role: UserRole = this.role()): string {
    if (role === 'admin') return '/admin';
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
