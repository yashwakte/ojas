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
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    httpMock?.verify();
    localStorage.clear();
  });

  function setup() {
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
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
    const req = { fullName: 'A', email: 'a@b.com', phone: '9999999999', password: 'secret' };
    service.register(req).subscribe((res) => expect(res).toEqual(authResponse));
    const call = httpMock.expectOne(`${environment.apiUrl}/auth/register`);
    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(req);
    call.flush(authResponse);
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
    const req = { email: 'a@b.com', password: 'secret' };
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

  it('logout() clears localStorage, resets the user signal, posts to /auth/logout, and navigates home', () => {
    setup();
    service.saveAuth(authResponse);
    spyOn(router, 'navigate');

    service.logout();

    expect(localStorage.getItem('ojas_user')).toBeNull();
    expect(service.user()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/']);

    const call = httpMock.expectOne(`${environment.apiUrl}/auth/logout`);
    expect(call.request.method).toBe('POST');
    expect(() => call.flush('boom', { status: 500, statusText: 'Server Error' })).not.toThrow();
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
