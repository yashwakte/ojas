import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { recoverFromStaleBuild } from './app/services/app-recovery.service';

// Covers the dynamic imports the Router never sees — `@defer` blocks and anything imported
// outside a navigation. Lazy *routes* are handled deterministically by withNavigationErrorHandler
// in app.config.ts, because the Router consumes that rejection itself on some navigation paths
// and it would never reach these listeners.
//
// Note what is deliberately NOT here any more: the guard used to be cleared when bootstrap
// resolved, which happens before a single lazy chunk has been fetched. That cleared the loop
// guard before the failure it guards against could occur. It is now cleared on the first
// successful navigation instead.
window.addEventListener('unhandledrejection', (event) => recoverFromStaleBuild(event.reason));
window.addEventListener('error', (event) => recoverFromStaleBuild(event.error ?? event.message));

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
