import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withNavigationErrorHandler,
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { AppRecoveryService } from './services/app-recovery.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      // A lazy route that will not load is the failure that used to leave a blank page between
      // the header and the footer, with nothing on screen to explain it and nothing to click.
      // The Router catches that rejection itself, so this - not a global unhandledrejection
      // listener - is the channel that reliably sees it.
      withNavigationErrorHandler((event) =>
        // event.url is where the customer was actually trying to go. Recovery reloads *to it*,
        // rather than reloading the URL the Router has just restored underneath them.
        inject(AppRecoveryService).onNavigationError(event.error, event.url),
      ),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Async variant: the animations engine loads in its own chunk instead of the initial
    // bundle. Animations still work identically - Material's own transitions and ripples
    // included - this only changes when the engine's code is fetched.
    provideAnimationsAsync(),
  ],
};
