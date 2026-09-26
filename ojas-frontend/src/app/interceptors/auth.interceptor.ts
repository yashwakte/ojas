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
// refresh again (AuthService.refreshOnce decides what a failed refresh means for the session).
const NO_REFRESH_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/verify-email-otp',
  '/auth/phone-signin',
  '/auth/refresh',
  '/auth/logout',
];

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

      // Only a 401 from our own API, on a signed-in session, is worth a refresh. Everything else
      // goes back to the caller untouched. That includes a 401 from some other host, which says
      // nothing about an Ojas session and used to sign the customer out regardless - and signing
      // out revokes the session for every tab in the browser.
      if (err.status !== 401 || !isApiRequest || isExempt || !authService.isLoggedIn()) {
        return throwError(() => err);
      }

      // Access token likely expired - try a silent refresh, then replay the original request
      // with the (possibly rotated) CSRF token that comes back with it. If the refresh fails,
      // AuthService.refreshOnce decides what that means for the session, and the error still
      // comes back here so the caller knows its own request did not go through.
      return authService.refreshOnce().pipe(
        switchMap(() => next(attachCredentials(req, authService.getCsrfToken()))),
      );
    }),
  );
};
