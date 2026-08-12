import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  adminGuard,
  deliveryGuard,
  roleHomeGuard,
  storefrontGuard,
  customerGuard,
} from './role.guard';
import { AuthService } from '../services/auth.service';
import { UserRole } from '../models/interfaces';

describe('role guards', () => {
  let router: Router;
  let auth: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => localStorage.clear());

  function login(role: UserRole) {
    auth.saveAuth({ id: 'u1', fullName: 'X', email: 'x@x.com', phone: '9999999999', role });
  }

  function run<T>(guard: (...args: any[]) => T, url = '/somewhere'): T {
    return TestBed.runInInjectionContext(() => guard({} as any, { url } as any));
  }

  describe('adminGuard', () => {
    it('redirects to /login when logged out', () => {
      const result = run(adminGuard, '/admin') as UrlTree;
      const expected = router.createUrlTree(['/login'], { queryParams: { redirect: '/admin' } });
      expect(result.toString()).toBe(expected.toString());
    });

    it('redirects to / when logged in with the wrong role', () => {
      login('customer');
      const result = run(adminGuard) as UrlTree;
      expect(result.toString()).toBe(router.createUrlTree(['/']).toString());
    });

    it('allows navigation for an admin', () => {
      login('admin');
      expect(run(adminGuard)).toBeTrue();
    });
  });

  describe('deliveryGuard', () => {
    it('redirects to /login when logged out', () => {
      const result = run(deliveryGuard, '/delivery/orders') as UrlTree;
      const expected = router.createUrlTree(['/login'], { queryParams: { redirect: '/delivery/orders' } });
      expect(result.toString()).toBe(expected.toString());
    });

    it('redirects to / when logged in with the wrong role', () => {
      login('admin');
      const result = run(deliveryGuard) as UrlTree;
      expect(result.toString()).toBe(router.createUrlTree(['/']).toString());
    });

    it('allows navigation for a delivery user', () => {
      login('delivery');
      expect(run(deliveryGuard)).toBeTrue();
    });
  });

  describe('roleHomeGuard', () => {
    it('allows navigation when logged out', () => {
      expect(run(roleHomeGuard)).toBeTrue();
    });

    it('allows navigation for a customer', () => {
      login('customer');
      expect(run(roleHomeGuard)).toBeTrue();
    });

    it('redirects an admin to /admin', () => {
      login('admin');
      const result = run(roleHomeGuard) as UrlTree;
      expect(result.toString()).toBe(router.createUrlTree(['/admin']).toString());
    });

    it('redirects a delivery user to /delivery/orders', () => {
      login('delivery');
      const result = run(roleHomeGuard) as UrlTree;
      expect(result.toString()).toBe(router.createUrlTree(['/delivery/orders']).toString());
    });
  });

  describe('storefrontGuard', () => {
    it('allows navigation when logged out', () => {
      expect(run(storefrontGuard)).toBeTrue();
    });

    it('allows navigation for a customer', () => {
      login('customer');
      expect(run(storefrontGuard)).toBeTrue();
    });

    it('redirects an admin to /admin', () => {
      login('admin');
      const result = run(storefrontGuard) as UrlTree;
      expect(result.toString()).toBe(router.createUrlTree(['/admin']).toString());
    });

    it('redirects a delivery user to /delivery/orders', () => {
      login('delivery');
      const result = run(storefrontGuard) as UrlTree;
      expect(result.toString()).toBe(router.createUrlTree(['/delivery/orders']).toString());
    });
  });

  describe('customerGuard', () => {
    it('redirects to /login when logged out', () => {
      const result = run(customerGuard, '/profile') as UrlTree;
      const expected = router.createUrlTree(['/login'], { queryParams: { redirect: '/profile' } });
      expect(result.toString()).toBe(expected.toString());
    });

    it('allows navigation for a customer', () => {
      login('customer');
      expect(run(customerGuard)).toBeTrue();
    });

    it('redirects an admin to their role home', () => {
      login('admin');
      const result = run(customerGuard) as UrlTree;
      expect(result.toString()).toBe(router.createUrlTree(['/admin']).toString());
    });

    it('redirects a delivery user to their role home', () => {
      login('delivery');
      const result = run(customerGuard) as UrlTree;
      expect(result.toString()).toBe(router.createUrlTree(['/delivery/orders']).toString());
    });
  });
});
