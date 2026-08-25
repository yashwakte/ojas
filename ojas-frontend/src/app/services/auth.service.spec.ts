import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { AuthResponse } from '../models/interfaces';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;
  let reloadPage: jasmine.Spy;

  /** Must match SESSION_SWITCH_NOTICE_MS in auth.service.ts. */
  const SESSION_SWITCH_NOTICE_MS = 1600;
  /** Must match LOGOUT_TIMEOUT_MS in auth.service.ts. */
  const LOGOUT_TIMEOUT_MS = 6000;

  const authResponse: AuthResponse = {
    id: 'u1',
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    phone: '9876543210',
    role: 'customer',
    csrfToken: 'csrf-abc',
  };

  beforeEach(() => {
    localStorage.clear();
    // The app is zoneless, so fakeAsync/tick aren't available - Jasmine's own clock is what
    // stands in for the delay between the switch notice appearing and the page reloading.
    // It has to be installed before any setTimeout this suite cares about is scheduled.
    jasmine.clock().install();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    httpMock?.verify();
    localStorage.clear();
  });

  function setup() {
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    // A resync ends in a real page reload, which inside a test runner takes the whole suite
    // down with it. Every test that starts one must also run the timer out on Jasmine's clock, so
    // the call lands on this spy while it is still installed rather than on the real thing
    // after Jasmine has restored it.
    reloadPage = spyOn(service as unknown as { reloadPage: () => void }, 'reloadPage');
  }

  it('should be created with no user when localStorage is empty', () => {
    setup();
    expect(service.user()).toBeNull();
    expect(service.isLoggedIn()).toBeFalse();
    expect(service.role()).toBe('customer');
    expect(service.isAdmin()).toBeFalse();
    expect(service.isDelivery()).toBeFalse();
  });

  it('should seed the user signal from localStorage on construction', () => {
    localStorage.setItem('ojas_user', JSON.stringify(authResponse));
    setup();
    expect(service.user()).toEqual(authResponse);
    expect(service.isLoggedIn()).toBeTrue();
  });

  it('should remove legacy shared-cart keys on construction', () => {
    localStorage.setItem('ojas_cart', '[{"old":true}]');
    localStorage.setItem('ojas_checkout', '[{"old":true}]');
    setup();
    expect(localStorage.getItem('ojas_cart')).toBeNull();
    expect(localStorage.getItem('ojas_checkout')).toBeNull();
  });

  it('isAdmin/isDelivery reflect role from user', () => {
    setup();
    service.saveAuth({ ...authResponse, role: 'admin' });
    expect(service.isAdmin()).toBeTrue();
    expect(service.isDelivery()).toBeFalse();

    service.saveAuth({ ...authResponse, role: 'delivery' });
    expect(service.isAdmin()).toBeFalse();
    expect(service.isDelivery()).toBeTrue();
  });

  it('register() posts to /auth/register', () => {
    setup();
    const req = { fullName: 'A', email: 'a@b.com', phone: '9999999999', password: 'secret', turnstileToken: 'tok' };
    const pending = { email: 'a@b.com', message: 'Check your inbox' };
    service.register(req).subscribe((res) => expect(res).toEqual(pending));
    const call = httpMock.expectOne(`${environment.apiUrl}/auth/register`);
    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(req);
    call.flush(pending);
  });

  it('verifyEmailOtp() posts to /auth/verify-email-otp', () => {
    setup();
    const req = { email: 'a@b.com', code: '123456' };
    service.verifyEmailOtp(req).subscribe((res) => expect(res).toEqual(authResponse));
    const call = httpMock.expectOne(`${environment.apiUrl}/auth/verify-email-otp`);
    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(req);
    call.flush(authResponse);
  });

  it('resendEmailOtp() posts to /auth/resend-email-otp', () => {
    setup();
    const req = { email: 'a@b.com' };
    const res = { message: 'ok' };
    service.resendEmailOtp(req).subscribe((r) => expect(r).toEqual(res));
    const call = httpMock.expectOne(`${environment.apiUrl}/auth/resend-email-otp`);
    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(req);
    call.flush(res);
  });

  it('checkEmail() gets /auth/check-email with query param', () => {
    setup();
    service.checkEmail('a@b.com').subscribe((res) => expect(res).toEqual({ exists: true }));
    const call = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/auth/check-email` && r.params.get('email') === 'a@b.com',
    );
    expect(call.request.method).toBe('GET');
    call.flush({ exists: true });
  });

  it('checkPhone() gets /auth/check-phone with query param', () => {
    setup();
    service.checkPhone('9999999999').subscribe((res) => expect(res).toEqual({ exists: false }));
    const call = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/auth/check-phone` && r.params.get('phone') === '9999999999',
    );
    call.flush({ exists: false });
  });

  it('login() posts to /auth/login', () => {
    setup();
    const req = { email: 'a@b.com', password: 'secret', turnstileToken: 'tok' };
    service.login(req).subscribe((res) => expect(res).toEqual(authResponse));
    const call = httpMock.expectOne(`${environment.apiUrl}/auth/login`);
    expect(call.request.method).toBe('POST');
    call.flush(authResponse);
  });

  it('createStaff() posts to /auth/staff', () => {
    setup();
    const req = {
      fullName: 'Staff',
      email: 's@b.com',
      phone: '9999999999',
      password: 'secret',
      role: 'delivery' as const,
    };
    service.createStaff(req).subscribe();
    const call = httpMock.expectOne(`${environment.apiUrl}/auth/staff`);
    expect(call.request.method).toBe('POST');
    call.flush({ id: 's1', fullName: 'Staff', email: 's@b.com', phone: '9999999999', role: 'delivery' });
  });

  it('ping() fires a GET and swallows errors', () => {
    setup();
    service.ping();
    const call = httpMock.expectOne(`${environment.apiUrl}/auth/ping`);
    expect(call.request.method).toBe('GET');
    // Should not throw even on error response, since subscribe has error: () => {}
    expect(() => call.flush('boom', { status: 500, statusText: 'Server Error' })).not.toThrow();
  });

  it('saveAuth() persists to localStorage and sets the user signal', () => {
    setup();
    service.saveAuth(authResponse);
    expect(service.user()).toEqual(authResponse);
    expect(JSON.parse(localStorage.getItem('ojas_user')!)).toEqual(authResponse);
  });

  it('logout() holds the local session until the server has answered, then clears and navigates', () => {
    // The wait is what stops a slow logout response landing on top of a subsequent login and
    // deleting its brand-new cookies - see the comment on AuthService.logout.
    setup();
    service.saveAuth(authResponse);
    spyOn(router, 'navigateByUrl');

    service.logout();

    const call = httpMock.expectOne(`${environment.apiUrl}/auth/logout`);
    expect(call.request.method).toBe('POST');
    expect(service.user()).withContext('still signed in until the server confirms').toEqual(authResponse);
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    call.flush('');

    expect(localStorage.getItem('ojas_user')).toBeNull();
    expect(service.user()).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('logout() still completes locally when the server call fails', () => {
    // A logout must never be something the user can be denied.
    setup();
    service.saveAuth(authResponse);
    spyOn(router, 'navigateByUrl');

    service.logout();

    const call = httpMock.expectOne(`${environment.apiUrl}/auth/logout`);
    expect(() => call.flush('boom', { status: 500, statusText: 'Server Error' })).not.toThrow();

    expect(localStorage.getItem('ojas_user')).toBeNull();
    expect(service.user()).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('logout() cancels the request when the server is too slow, so it cannot land later', () => {
    // This is the whole point of the ceiling. On a cold Render instance the logout response can
    // take far longer than the user takes to sign in again, and it carries expired Set-Cookie
    // headers - landing after a fresh sign-in it would delete that new session's cookies.
    // Unsubscribing cancels the request, so an abandoned logout is aborted rather than left in
    // flight to arrive at the worst possible moment.
    setup();
    service.saveAuth(authResponse);
    spyOn(router, 'navigateByUrl');

    service.logout();
    const call = httpMock.expectOne(`${environment.apiUrl}/auth/logout`);
    expect(call.cancelled).toBeFalse();

    jasmine.clock().tick(LOGOUT_TIMEOUT_MS + 1);

    expect(call.cancelled).withContext('the abandoned request must be aborted').toBeTrue();
    // And the user is signed out locally regardless - a logout must never be deniable.
    expect(service.user()).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('syncSession() adopts a newer profile from the server without disturbing the session', () => {
    setup();
    service.saveAuth(authResponse);

    service.syncSession(true);

    httpMock.expectOne(`${environment.apiUrl}/auth/session`).flush({
      ...authResponse,
      fullName: 'Jane Renamed',
      csrfToken: 'csrf-abc',
    });

    expect(service.user()?.fullName).toBe('Jane Renamed');
    expect(service.sessionChange()).toBeNull();
  });

  it('syncSession() ignores an empty session body instead of treating it as a stranger', () => {
    // An API that predates /auth/session describing the session answers 200 with no body, which
    // parses to null. That is exactly what a new frontend gets while the old backend is still
    // live during a split deploy - and reading an id off it would make every signed-in tab
    // decide it belonged to someone else and reload itself, over and over.
    setup();
    service.saveAuth(authResponse);

    service.syncSession(true);
    httpMock.expectOne(`${environment.apiUrl}/auth/session`).flush(null);

    expect(service.sessionChange()).toBeNull();
    expect(service.user()).toEqual(authResponse);

    jasmine.clock().tick(SESSION_SWITCH_NOTICE_MS);
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('syncSession() makes no request when nobody is signed in', () => {
    setup();
    service.syncSession(true);
    httpMock.expectNone(`${environment.apiUrl}/auth/session`);
  });

  it('onServerIdentity() ignores a response served for the account already signed in', () => {
    setup();
    service.saveAuth(authResponse);

    service.onServerIdentity(authResponse.id);

    httpMock.expectNone(`${environment.apiUrl}/auth/session`);
    expect(service.sessionChange()).toBeNull();
  });

  it('onServerIdentity() resynchronises when the cookie turns out to belong to someone else', () => {
    // This is the two-tab data leak: the cached user says one person, the cookie says another,
    // and without this the page renders the first name over the second person's data.
    setup();
    service.saveAuth(authResponse);

    service.onServerIdentity('someone-else');

    httpMock.expectOne(`${environment.apiUrl}/auth/session`).flush({
      id: 'someone-else',
      fullName: 'Rajesh Kumar',
      email: 'rajesh@example.com',
      phone: '7057428881',
      role: 'customer',
      csrfToken: 'csrf-xyz',
    });

    expect(service.sessionChange()).toEqual({ kind: 'switched', name: 'Rajesh' });
    // The reloaded app must come up as the account the cookie actually belongs to.
    expect(service.user()?.id).toBe('someone-else');
    expect(service.user()?.csrfToken).toBe('csrf-xyz');

    jasmine.clock().tick(SESSION_SWITCH_NOTICE_MS);
    expect(reloadPage).toHaveBeenCalled();
  });

  it('onServerIdentity() only ever starts one resync, however many signals arrive', () => {
    setup();
    service.saveAuth(authResponse);

    service.onServerIdentity('someone-else');
    httpMock.expectOne(`${environment.apiUrl}/auth/session`).flush({
      id: 'someone-else',
      fullName: 'Rajesh Kumar',
      email: 'rajesh@example.com',
      phone: '7057428881',
      role: 'customer',
      csrfToken: 'csrf-xyz',
    });

    // The identity header rides on every response, so this fires repeatedly while the notice
    // is up. It must not queue a second reload or a second /auth/session call.
    service.onServerIdentity('someone-else');
    httpMock.expectNone(`${environment.apiUrl}/auth/session`);

    jasmine.clock().tick(SESSION_SWITCH_NOTICE_MS);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('onServerIdentity() still covers the page when the new identity cannot be fetched', () => {
    setup();
    service.saveAuth(authResponse);

    service.onServerIdentity('someone-else');

    httpMock
      .expectOne(`${environment.apiUrl}/auth/session`)
      .flush('nope', { status: 500, statusText: 'Server Error' });

    // Who it is now is unknown, but it is definitely not who this tab was showing.
    expect(service.sessionChange()).toEqual({ kind: 'switched', name: '' });

    jasmine.clock().tick(SESSION_SWITCH_NOTICE_MS);
    expect(reloadPage).toHaveBeenCalled();
  });

  it('onOtherTabSessionChange() resynchronises when another tab signs in as someone else', () => {
    setup();
    service.saveAuth(authResponse);

    service.onOtherTabSessionChange(
      JSON.stringify({ ...authResponse, id: 'u2', fullName: 'Rajesh Kumar', csrfToken: 'csrf-2' }),
    );

    expect(service.sessionChange()).toEqual({ kind: 'switched', name: 'Rajesh' });

    jasmine.clock().tick(SESSION_SWITCH_NOTICE_MS);
    expect(reloadPage).toHaveBeenCalled();
  });

  it('onOtherTabSessionChange() takes a rotated CSRF token from the same account without reloading', () => {
    // The token rotates on every silent refresh and only the tab that made that call learns the
    // new value; without this every mutating request from this tab would be rejected as forged.
    setup();
    service.saveAuth(authResponse);

    service.onOtherTabSessionChange(JSON.stringify({ ...authResponse, csrfToken: 'csrf-rotated' }));

    expect(service.getCsrfToken()).toBe('csrf-rotated');
    expect(service.sessionChange()).toBeNull();

    jasmine.clock().tick(SESSION_SWITCH_NOTICE_MS);
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('onOtherTabSessionChange() signs this tab out when another tab signs out', () => {
    setup();
    service.saveAuth(authResponse);
    spyOn(router, 'navigateByUrl');

    service.onOtherTabSessionChange(null);

    expect(service.sessionChange()).toEqual({ kind: 'signed-out' });
    expect(service.user()).toBeNull();
    expect(localStorage.getItem('ojas_user')).toBeNull();

    jasmine.clock().tick(SESSION_SWITCH_NOTICE_MS);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    expect(service.sessionChange()).toBeNull();
    // Signing out is not a resync - the app is not rebuilt, it just leaves.
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('onOtherTabSessionChange() does nothing when nobody was signed in here anyway', () => {
    setup();

    service.onOtherTabSessionChange(null);

    expect(service.sessionChange()).toBeNull();
  });

  it('treats an unparseable cached user as signed out rather than throwing', () => {
    // A corrupt entry would otherwise take the app down at construction, before a single route
    // renders, with no way to clear it short of the browser's own devtools.
    localStorage.setItem('ojas_user', 'not-json{');
    setup();

    expect(service.user()).toBeNull();
    expect(service.isLoggedIn()).toBeFalse();
  });

  it('getDefaultRouteForRole() maps roles to routes', () => {
    setup();
    expect(service.getDefaultRouteForRole('admin')).toBe('/admin');
    expect(service.getDefaultRouteForRole('delivery')).toBe('/delivery/orders');
    expect(service.getDefaultRouteForRole('customer')).toBe('/');
  });

  it('getDefaultRouteForRole() defaults to the current role when no argument given', () => {
    setup();
    service.saveAuth({ ...authResponse, role: 'admin' });
    expect(service.getDefaultRouteForRole()).toBe('/admin');
  });

  it('getCsrfToken() returns the token from the current user, or null when logged out', () => {
    setup();
    expect(service.getCsrfToken()).toBeNull();
    service.saveAuth(authResponse);
    expect(service.getCsrfToken()).toBe('csrf-abc');
  });

  it('getToken() always returns null', () => {
    setup();
    expect(service.getToken()).toBeNull();
  });

  it('updateUserInfo() merges updates into the current user and persists them', () => {
    setup();
    service.saveAuth(authResponse);
    service.updateUserInfo({ fullName: 'New Name' });
    expect(service.user()?.fullName).toBe('New Name');
    expect(service.user()?.email).toBe(authResponse.email);
    expect(JSON.parse(localStorage.getItem('ojas_user')!).fullName).toBe('New Name');
  });

  it('updateUserInfo() is a no-op when there is no current user', () => {
    setup();
    service.updateUserInfo({ fullName: 'New Name' });
    expect(service.user()).toBeNull();
  });
});
