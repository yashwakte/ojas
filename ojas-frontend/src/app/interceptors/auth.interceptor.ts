import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const isApiRequest = req.url.startsWith(environment.apiUrl);
  let cloned = req;

  if (isApiRequest) {
    const method = req.method.toUpperCase();
    const needsCsrf = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    const csrfToken = authService.getCsrfToken();

    if (needsCsrf && csrfToken) {
      cloned = req.clone({
        withCredentials: true,
        setHeaders: { 'X-CSRF-Token': csrfToken },
      });
    } else {
      cloned = req.clone({ withCredentials: true });
    }
  }

  return next(cloned).pipe(
    tap({
      error: (err) => {
        // Only auto-logout for a 401 on an already-authenticated session (i.e. the
        // session expired server-side). A 401 while logged out - e.g. wrong
        // credentials on the login form - must not force a redirect away from
        // the page the user is on.
        if (err.status === 401 && authService.isLoggedIn()) {
          authService.logout();
        }
      },
    }),
  );
};
