import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, shareReplay, tap, throwError, timeout } from 'rxjs';
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
  SessionResponse,
  StaffDeviceResponse,
  StaffUserResponse,
  UserRole,
  VerifyEmailOtpRequest,
} from '../models/interfaces';

/**
 * What a tab is doing about a session that changed underneath it - see
 * AuthService.adoptSession and AuthService.abandonSession. Rendered by SessionSwitchNotice,
 * which covers the page while it happens so no stale identity is ever left on screen.
 */
export type SessionChange =
  | { kind: 'switched'; name: string }
  | { kind: 'signed-out' };

/** How long the notice is held before the page reloads - long enough to be read, short enough
 * not to feel like a hang. */
const SESSION_SWITCH_NOTICE_MS = 1600;

/** A session check on every single tab focus would be a request per alt-tab; this is the floor
 * between them. Any real mismatch is caught long before this by the storage event and by the
 * identity header on the very next response, so this is only a backstop. */
const SESSION_SYNC_MIN_INTERVAL_MS = 30_000;

/** Ceiling on how long a logout may block on the server before it completes locally anyway. */
const LOGOUT_TIMEOUT_MS = 6000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${environment.apiUrl}/auth`;
  private readonly USER_KEY = 'ojas_user';
  private readonly _user = signal<AuthResponse | null>(this.loadUser());
  private readonly _sessionChange = signal<SessionChange | null>(null);

  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => !!this._user());
  readonly role = computed(() => this._user()?.role ?? 'customer');
  readonly isAdmin = computed(() => this.role() === 'admin');
  readonly isDelivery = computed(() => this.role() === 'delivery');

  /** Non-null while this tab is resynchronising onto a session that changed elsewhere. */
  readonly sessionChange = this._sessionChange.asReadonly();

  /** Latched once a resync has been decided on, so the storage event, the identity header and
   * the periodic check can't each start their own. */
  private resyncing = false;
  private lastSyncAt = 0;

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {
    // Remove legacy shared-cart keys that were not scoped to a user
    localStorage.removeItem('ojas_cart');
    localStorage.removeItem('ojas_checkout');

    this.watchOtherTabs();
  }

  // ---------------------------------------------------------------------------------------
  // Session identity
  //
  // Cookies and localStorage belong to a browser profile, not to a tab. Signing into a second
  // account in one tab silently repoints every other tab's cookie at the new account, while
  // those tabs carry on rendering the old one from their in-memory copy - one person's name and
  // menu above another person's orders, addresses and wallet. Nothing about that requires an
  // attacker; two tabs are enough.
  //
  // So the server is treated as the only authority on who is signed in, and this tab reconciles
  // against it from three directions:
  //
  //   1. the storage event, which fires the instant another tab writes or clears the cached
  //      user - no network, no delay;
  //   2. the X-Ojas-User header on every authenticated response, which catches a cookie that
  //      changed without localStorage changing with it, on the first response that proves it;
  //   3. an explicit /auth/session check on load and on tab focus, which catches the rest,
  //      including a session that expired server-side.
  //
  // Whatever spots it, the resolution is the same and deliberately blunt: reload. Patching the
  // user signal would leave every other service - cart, checkout, orders, addresses - holding
  // state built for the previous account.
  // ---------------------------------------------------------------------------------------

  private watchOtherTabs(): void {
    window.addEventListener('storage', (event) => {
      if (event.key === this.USER_KEY) this.onOtherTabSessionChange(event.newValue);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.syncSession();
    });
  }

  /**
   * Called with whatever another tab just wrote to the cached-user key - the raw new value, or
   * null if it cleared it. The storage event only ever fires in the *other* tabs, never the one
   * that made the change, so this is always news.
   */
  onOtherTabSessionChange(raw: string | null): void {
    const incoming = this.parseUser(raw);
    const current = this._user();

    if (!incoming) {
      // Another tab signed out. The cookies are gone browser-wide, so this tab is done too.
      if (current) this.abandonSession();
      return;
    }

    if (incoming.id !== current?.id) {
      this.adoptSession(incoming.fullName);
      return;
    }

    // Same person, so nothing needs rebuilding - but this tab still has to take the update.
    // The CSRF token rotates on every silent refresh, and only the tab that made that call
    // learns the new value from the response; every other tab would carry on sending the old
    // one and have every mutating request it makes rejected as a forged one.
    //
    // Set the signal directly rather than going through saveAuth: the value already came out
    // of localStorage, so writing it back would fire this same event in the tab that sent it
    // and the two would bounce it between them.
    this._user.set(incoming);
  }

  /**
   * Asks the server who this browser's cookie belongs to and reconciles the cached user with
   * the answer. Throttled, because it runs on every tab focus.
   */
  syncSession(force = false): void {
    if (!this._user() || this.resyncing) return;

    const now = Date.now();
    if (!force && now - this.lastSyncAt < SESSION_SYNC_MIN_INTERVAL_MS) return;
    this.lastSyncAt = now;

    this.http.get<SessionResponse | null>(`${this.apiUrl}/session`).subscribe({
      next: (session) => this.reconcile(session),
      // A 401 here means the session is gone, which the interceptor already turns into a
      // logout - there is nothing extra to do, and nothing worth showing the user.
      error: () => {},
    });
  }

  private reconcile(session: SessionResponse | null): void {
    const cached = this._user();
    if (!cached) return;

    // An API that predates this endpoint describing the session answers 200 with no body at
    // all, which parses to null. During a split deploy - a new frontend live before the new
    // backend - that is exactly what this call gets back, and reading an id off it would make
    // every signed-in tab think it belonged to somebody else and reload itself in a loop.
    // Silence is not evidence of a different account: when the server says nothing, do nothing.
    if (!session?.id) return;

    if (cached.id !== session.id) {
      this.saveAuth({ ...session });
      this.adoptSession(session.fullName);
      return;
    }

    // Same person, so no reload is warranted - but the server may still know something newer
    // than the cache does (a profile edited on another device, a role changed by an admin).
    const changed =
      cached.fullName !== session.fullName ||
      cached.email !== session.email ||
      cached.phone !== session.phone ||
      cached.role !== session.role ||
      (!!session.csrfToken && cached.csrfToken !== session.csrfToken);

    if (changed) this.saveAuth({ ...cached, ...session });
  }

  /**
   * Called by the auth interceptor with the account id the server says a response was served
   * for. A disagreement means the cookie was repointed at someone else.
   */
  onServerIdentity(serverUserId: string): void {
    const cached = this._user();
    if (!cached || this.resyncing || cached.id === serverUserId) return;

    // Fetch the new identity before reloading so the notice can name who this is now, and so
    // the reloaded app starts from the right cached user and the right CSRF token.
    this.http.get<SessionResponse | null>(`${this.apiUrl}/session`).subscribe({
      next: (session) => {
        if (!session?.id) {
          // The header already proved this tab is wrong about who it is; not being able to name
          // the replacement is no reason to leave the old identity on screen.
          this.adoptSession('');
          return;
        }
        this.saveAuth({ ...session });
        this.adoptSession(session.fullName);
      },
      // Couldn't confirm who it is, but it is definitely not who this tab thinks - so the
      // cached identity must not stay on screen either way.
      error: () => this.adoptSession(''),
    });
  }

  /** This browser now belongs to someone else. Say so, then rebuild the app from scratch. */
  private adoptSession(name: string): void {
    if (this.resyncing) return;
    this.resyncing = true;
    this._sessionChange.set({ kind: 'switched', name: name.trim().split(/\s+/)[0] ?? '' });
    setTimeout(() => this.reloadPage(), SESSION_SWITCH_NOTICE_MS);
  }

  /** The one place the page is reloaded, kept as its own method so tests can stand in for it -
   * a real reload inside a test runner takes the whole suite down with it. */
  private reloadPage(): void {
    window.location.reload();
  }

  /** Another tab signed this browser out. */
  private abandonSession(): void {
    if (this.resyncing) return;
    this.resyncing = true;
    this._sessionChange.set({ kind: 'signed-out' });
    this.clearLocalSession();
    setTimeout(() => {
      this._sessionChange.set(null);
      this.resyncing = false;
      this.router.navigateByUrl('/login');
    }, SESSION_SWITCH_NOTICE_MS);
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

  /**
   * Signs this browser out, and waits for the server to say it has before moving on.
   *
   * The wait is not politeness. Logout responds with expired Set-Cookie headers, and on a cold
   * Render instance that response can take seconds to arrive - long enough for someone to reach
   * the login screen and sign in first. The late logout response would then land on top of the
   * brand-new session and delete its cookies, leaving a browser that believes it is signed in
   * while every request it makes is rejected, which resolves into a redirect back to the login
   * screen. Clearing local state only once the server has answered removes the overlap.
   *
   * If the server never answers, the local session is cleared anyway - a logout must never be
   * something the user can be denied.
   */
  logout() {
    if (this.loggingOut) return;
    this.loggingOut = true;

    this.http
      .post(`${this.apiUrl}/logout`, {}, { responseType: 'text' })
      .pipe(timeout(LOGOUT_TIMEOUT_MS))
      .subscribe({
        next: () => this.finishLogout(),
        error: () => this.finishLogout(),
      });
  }

  private loggingOut = false;

  private finishLogout(): void {
    this.loggingOut = false;
    this.clearLocalSession();
    this.router.navigateByUrl('/login');
  }

  private clearLocalSession(): void {
    localStorage.removeItem(this.USER_KEY);
    this._user.set(null);
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
    return this.parseUser(localStorage.getItem(this.USER_KEY));
  }

  /** Anything unparseable is treated as "not signed in" rather than thrown - a corrupt entry
   * here would otherwise take the whole app down at construction, before a single route
   * renders, and leave no way to clear it short of the browser's own devtools. */
  private parseUser(raw: string | null): AuthResponse | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AuthResponse | null;
      return parsed?.id ? parsed : null;
    } catch {
      return null;
    }
  }
}
