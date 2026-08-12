import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

describe('authGuard', () => {
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => localStorage.clear());

  it('allows navigation when the user is logged in', () => {
    const auth = TestBed.inject(AuthService);
    auth.saveAuth({ id: 'u1', fullName: 'Jane', email: 'j@x.com', phone: '9999999999', role: 'customer' });

    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: '/cart' } as any),
    );

    expect(result).toBeTrue();
  });

  it('redirects to /login with a redirect query param when logged out', () => {
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: '/cart' } as any),
    ) as UrlTree;

    expect(result instanceof UrlTree).toBeTrue();
    const expected = router.createUrlTree(['/login'], { queryParams: { redirect: '/cart' } });
    expect(result.toString()).toBe(expected.toString());
  });
});
