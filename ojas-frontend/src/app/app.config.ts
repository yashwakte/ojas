import {
  ApplicationConfig,
  Injector,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withNavigationErrorHandler,
  withPreloading,
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { AppRecoveryService } from './services/app-recovery.service';
import { StorefrontPreloadStrategy } from './preload-storefront';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // SeoService keeps each page's title, description and canonical address right. It is fetched
    // in its own chunk rather than the first download, because nothing it does is needed to draw
    // the first screen — index.html already carries the home page's title and description — and
    // that download is at its size budget. It describes whichever page is open when it arrives.
    // Not awaited, so it never holds up the app; a failed fetch only means default tags.
    provideAppInitializer(() => {
      const injector = inject(Injector);
      void import('./services/seo.service')
        .then(({ SeoService }) => injector.get(SeoService))
        .catch(() => undefined);
    }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      // Fetches the storefront's screens while the browser is idle, so clicking Products, a
      // product, or the cart renders immediately instead of waiting on a chunk. See
      // StorefrontPreloadStrategy for what it will and will not fetch.
      withPreloading(StorefrontPreloadStrategy),
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
