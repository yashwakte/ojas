import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Session-bootstrap endpoints must never trigger a refresh attempt off their own 401/403 -
// login/register have no session to refresh yet, and refresh itself failing shouldn't try to
// refresh again (that failure already logs the user out inside AuthService.refreshOnce).
const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/verify-email-otp', '/auth/refresh', '/auth/logout'];

function attachCredentials(req: HttpRequest<unknown>, csrfToken: string | null): HttpRequest<unknown> {
  const needsCsrf = MUTATING_METHODS.includes(req.method.toUpperCase());
  return needsCsrf && csrfToken
    ? req.clone({ withCredentials: true, setHeaders: { 'X-CSRF-Token': csrfToken } })
    : req.clone({ withCredentials: true });
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const isApiRequest = req.url.startsWith(environment.apiUrl);
  const cloned = isApiRequest ? attachCredentials(req, authService.getCsrfToken()) : req;

  return next(cloned).pipe(
    catchError((err: HttpErrorResponse) => {
      const isExempt = NO_REFRESH_PATHS.some((path) => req.url.includes(path));

      if (err.status !== 401 || !isApiRequest || isExempt || !authService.isLoggedIn()) {
        // Only auto-logout for a 401 on an already-authenticated, non-exempt session (i.e. the
        // session expired server-side and there's nothing left to refresh). A 401 while logged
        // out - e.g. wrong credentials on the login form - must not force a redirect away from
        // the page the user is on.
        if (err.status === 401 && authService.isLoggedIn() && !isExempt) {
          authService.logout();
        }
        return throwError(() => err);
      }

      // Access token likely expired - try a silent refresh, then replay the original request
      // with the (possibly rotated) CSRF token that comes back with it. AuthService.refreshOnce
      // already logs the user out if the refresh itself fails, so no separate handling needed here.
      return authService.refreshOnce().pipe(
        switchMap(() => next(attachCredentials(req, authService.getCsrfToken()))),
      );
    }),
  );
};
