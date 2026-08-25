import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('reports the account a response was served for, so a swapped session is caught immediately', () => {
    const signedIn = { id: 'u1', fullName: 'X', email: 'x@x.com', phone: '9999999999', role: 'customer' as const, csrfToken: 't' };
    auth.saveAuth(signedIn);
    spyOn(auth, 'onServerIdentity');

    http.get(`${environment.apiUrl}/orders/my`).subscribe();
    httpMock
      .expectOne(`${environment.apiUrl}/orders/my`)
      .flush([], { headers: { 'X-Ojas-User': 'someone-else' } });

    expect(auth.onServerIdentity).toHaveBeenCalledWith('someone-else');
  });

  it('does not report identity for /auth responses, which answer as the account being established', () => {
    // Login answers as the new account a moment before the client has saved it - checking it
    // would look like a mismatch on every single sign-in.
    auth.saveAuth({ id: 'u1', fullName: 'X', email: 'x@x.com', phone: '9999999999', role: 'customer', csrfToken: 't' });
    spyOn(auth, 'onServerIdentity');

    http.post(`${environment.apiUrl}/auth/login`, {}).subscribe();
    httpMock
      .expectOne(`${environment.apiUrl}/auth/login`)
      .flush({}, { headers: { 'X-Ojas-User': 'u2' } });

    expect(auth.onServerIdentity).not.toHaveBeenCalled();
  });

  it('does not report identity for non-API responses', () => {
    spyOn(auth, 'onServerIdentity');

    http.get('https://other-domain.example.com/data').subscribe();
    httpMock
      .expectOne('https://other-domain.example.com/data')
      .flush({}, { headers: { 'X-Ojas-User': 'u2' } });

    expect(auth.onServerIdentity).not.toHaveBeenCalled();
  });

  it('passes non-API requests through unchanged (no withCredentials, no CSRF header)', () => {
    http.get('https://other-domain.example.com/data').subscribe();
    const req = httpMock.expectOne('https://other-domain.example.com/data');
    expect(req.request.withCredentials).toBeFalse();
    expect(req.request.headers.has('X-CSRF-Token')).toBeFalse();
    req.flush({});
  });

  it('adds withCredentials but no CSRF header to an API GET request', () => {
    http.get(`${environment.apiUrl}/products`).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/products`);
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('X-CSRF-Token')).toBeFalse();
    req.flush({});
  });

  it('adds withCredentials + X-CSRF-Token to a mutating API request when a token is available', () => {
    auth.saveAuth({ id: 'u1', fullName: 'X', email: 'x@x.com', phone: '9999999999', role: 'customer', csrfToken: 'tok-123' });

    http.post(`${environment.apiUrl}/orders`, {}).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/orders`);
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.get('X-CSRF-Token')).toBe('tok-123');
    req.flush({});
  });

  it('adds the CSRF header for PUT, PATCH, and DELETE as well', () => {
    auth.saveAuth({ id: 'u1', fullName: 'X', email: 'x@x.com', phone: '9999999999', role: 'customer', csrfToken: 'tok-abc' });

    http.put(`${environment.apiUrl}/user/profile`, {}).subscribe();
    httpMock.expectOne((r) => r.method === 'PUT').flush({});

    http.patch(`${environment.apiUrl}/orders/o1/status`, {}).subscribe();
    const patchReq = httpMock.expectOne((r) => r.method === 'PATCH');
    expect(patchReq.request.headers.get('X-CSRF-Token')).toBe('tok-abc');
    patchReq.flush({});

    http.delete(`${environment.apiUrl}/user/addresses/0`).subscribe();
    const delReq = httpMock.expectOne((r) => r.method === 'DELETE');
    expect(delReq.request.headers.get('X-CSRF-Token')).toBe('tok-abc');
    delReq.flush({});
  });

  it('adds withCredentials but no CSRF header on a mutating request when no token is available', () => {
    http.post(`${environment.apiUrl}/auth/login`, {}).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/auth/login`);
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('X-CSRF-Token')).toBeFalse();
    req.flush({});
  });

  it('attempts a silent refresh on a 401 for a mutating request, then retries with the fresh CSRF token', () => {
    auth.saveAuth({ id: 'u1', fullName: 'X', email: 'x@x.com', phone: '9999999999', role: 'customer', csrfToken: 'old-csrf' });

    let result: unknown;
    http.put(`${environment.apiUrl}/user/profile`, {}).subscribe((res) => (result = res));

    const firstAttempt = httpMock.expectOne(`${environment.apiUrl}/user/profile`);
    expect(firstAttempt.request.headers.get('X-CSRF-Token')).toBe('old-csrf');
    firstAttempt.flush('unauthorized', { status: 401, statusText: 'Unauthorized' });

    const refreshReq = httpMock.expectOne(`${environment.apiUrl}/auth/refresh`);
    refreshReq.flush({ id: 'u1', fullName: 'X', email: 'x@x.com', phone: '9999999999', role: 'customer', csrfToken: 'new-csrf' });

    const retryReq = httpMock.expectOne(`${environment.apiUrl}/user/profile`);
    expect(retryReq.request.headers.get('X-CSRF-Token')).toBe('new-csrf');
    retryReq.flush({ ok: true });

    expect(result).toEqual({ ok: true });
  });

  it('logs out when the silent refresh itself fails', () => {
    auth.saveAuth({ id: 'u1', fullName: 'X', email: 'x@x.com', phone: '9999999999', role: 'customer', csrfToken: 'old-csrf' });
    spyOn(auth, 'logout');

    let errorStatus: number | undefined;
    http.get(`${environment.apiUrl}/user/profile`).subscribe({ error: (err) => (errorStatus = err.status) });

    const firstAttempt = httpMock.expectOne(`${environment.apiUrl}/user/profile`);
    firstAttempt.flush('unauthorized', { status: 401, statusText: 'Unauthorized' });

    const refreshReq = httpMock.expectOne(`${environment.apiUrl}/auth/refresh`);
    refreshReq.flush('unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(auth.logout).toHaveBeenCalled();
    expect(errorStatus).toBe(401);
  });

  it('shares a single refresh call across requests that 401 around the same time', () => {
    auth.saveAuth({ id: 'u1', fullName: 'X', email: 'x@x.com', phone: '9999999999', role: 'customer', csrfToken: 'old-csrf' });

    const results: unknown[] = [];
    http.get(`${environment.apiUrl}/user/profile`).subscribe((res) => results.push(res));
    http.get(`${environment.apiUrl}/orders`).subscribe((res) => results.push(res));

    const profileReq = httpMock.expectOne(`${environment.apiUrl}/user/profile`);
    const ordersReq = httpMock.expectOne(`${environment.apiUrl}/orders`);
    profileReq.flush('unauthorized', { status: 401, statusText: 'Unauthorized' });
    ordersReq.flush('unauthorized', { status: 401, statusText: 'Unauthorized' });

    // Exactly one /refresh call handles both - a second expectOne would fail if a duplicate fired.
    const refreshReq = httpMock.expectOne(`${environment.apiUrl}/auth/refresh`);
    refreshReq.flush({ id: 'u1', fullName: 'X', email: 'x@x.com', phone: '9999999999', role: 'customer', csrfToken: 'new-csrf' });

    httpMock.expectOne(`${environment.apiUrl}/user/profile`).flush({ from: 'profile' });
    httpMock.expectOne(`${environment.apiUrl}/orders`).flush({ from: 'orders' });

    expect(results).toEqual([{ from: 'profile' }, { from: 'orders' }]);
  });

  it('does not call authService.logout() on a 401 while logged out (e.g. wrong login credentials)', () => {
    spyOn(auth, 'logout');
    http.post(`${environment.apiUrl}/auth/login`, {}).subscribe({ error: () => {} });
    const req = httpMock.expectOne(`${environment.apiUrl}/auth/login`);
    req.flush('invalid credentials', { status: 401, statusText: 'Unauthorized' });
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('does not call authService.logout() on non-401 errors', () => {
    spyOn(auth, 'logout');
    http.get(`${environment.apiUrl}/user/profile`).subscribe({ error: () => {} });
    const req = httpMock.expectOne(`${environment.apiUrl}/user/profile`);
    req.flush('server error', { status: 500, statusText: 'Server Error' });
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
