import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, tap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** The API names the account every authenticated response was served for. See the middleware
 * in Program.cs, and AuthService.onServerIdentity for what a disagreement means. */
const SESSION_IDENTITY_HEADER = 'X-Ojas-User';

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
    tap((event) => {
      if (!isApiRequest || !(event instanceof HttpResponse)) return;

      // Everything under /auth is exempt, because those are the endpoints that *establish* a
      // session: login, invite acceptance, device enrolment and the rest all answer as the new
      // account a moment before the client has saved it, and would look like a mismatch every
      // single time. Anything that reads real data - orders, profile, wallet - is checked, and
      // that is precisely the set of responses where showing the wrong person's data matters.
      if (req.url.includes('/auth/')) return;

      const serverUserId = event.headers.get(SESSION_IDENTITY_HEADER);
      if (serverUserId) authService.onServerIdentity(serverUserId);
    }),
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
