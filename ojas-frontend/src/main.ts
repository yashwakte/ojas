import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Vercel's production alias always serves the latest deploy's file set. A browser tab left open
// for hours across a newer deploy still has the *old* chunk hashes baked into its
// already-executing bundle - the first lazy-loaded route or @defer block it then tries to fetch
// 404s (that file is simply gone), which otherwise surfaces as a silent, permanently blank page
// rather than an error the user can act on. Reload once to pick up the current deploy.
const STALE_CHUNK_RELOAD_KEY = 'ojas_stale_chunk_reload';

function isStaleChunkError(reason: unknown): boolean {
  const message = String((reason as { message?: unknown })?.message ?? reason ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|error loading dynamically imported module/i.test(
    message,
  );
}

function reloadOnStaleChunk(reason: unknown): void {
  if (!isStaleChunkError(reason)) return;
  // Guards against a reload loop if this ever turns out not to be a stale-deploy incident (e.g.
  // the user is genuinely offline) - one attempt per browser session, not an infinite retry.
  if (sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) return;
  sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, '1');
  window.location.reload();
}

window.addEventListener('unhandledrejection', (event) => reloadOnStaleChunk(event.reason));
window.addEventListener('error', (event) => reloadOnStaleChunk(event.error ?? event.message));

bootstrapApplication(App, appConfig)
  .then(() => sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY))
  .catch((err) => console.error(err));
