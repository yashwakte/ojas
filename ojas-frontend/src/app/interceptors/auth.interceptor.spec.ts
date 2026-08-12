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

  it('calls authService.logout() when a request receives a 401', () => {
    spyOn(auth, 'logout');
    http.get(`${environment.apiUrl}/user/profile`).subscribe({ error: () => {} });
    const req = httpMock.expectOne(`${environment.apiUrl}/user/profile`);
    req.flush('unauthorized', { status: 401, statusText: 'Unauthorized' });
    expect(auth.logout).toHaveBeenCalled();
  });

  it('does not call authService.logout() on non-401 errors', () => {
    spyOn(auth, 'logout');
    http.get(`${environment.apiUrl}/user/profile`).subscribe({ error: () => {} });
    const req = httpMock.expectOne(`${environment.apiUrl}/user/profile`);
    req.flush('server error', { status: 500, statusText: 'Server Error' });
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
