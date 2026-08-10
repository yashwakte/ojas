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
    const csrfToken = document.cookie
      .split('; ')
      .find((row) => row.startsWith('ojas_csrf='))
      ?.split('=')[1];

    if (needsCsrf && csrfToken) {
      cloned = req.clone({
        withCredentials: true,
        setHeaders: { 'X-CSRF-Token': decodeURIComponent(csrfToken) },
      });
    } else {
      cloned = req.clone({ withCredentials: true });
    }
  }

  return next(cloned).pipe(
    tap({
      error: (err) => {
        if (err.status === 401) {
          authService.logout();
        }
      },
    }),
  );
};
