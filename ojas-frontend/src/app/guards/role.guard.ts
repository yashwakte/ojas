import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserRole } from '../models/interfaces';

function routeForRole(role: UserRole): string {
  if (role === 'admin') return '/admin/orders';
  if (role === 'delivery') return '/delivery/orders';
  return '/';
}

function requireRole(role: UserRole): CanActivateFn {
  return (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.isLoggedIn()) {
      return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
    }

    if (auth.role() !== role) {
      return router.createUrlTree(['/']);
    }

    return true;
  };
}

export const adminGuard = requireRole('admin');
export const deliveryGuard = requireRole('delivery');

export const roleHomeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn() || auth.role() === 'customer') {
    return true;
  }

  return router.createUrlTree([routeForRole(auth.role())]);
};

export const storefrontGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn() || auth.role() === 'customer') {
    return true;
  }

  return router.createUrlTree([routeForRole(auth.role())]);
};

export const customerGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  if (auth.role() === 'customer') {
    return true;
  }

  return router.createUrlTree([routeForRole(auth.role())]);
};
