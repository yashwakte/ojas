import { Injectable, signal } from '@angular/core';

/**
 * Recovery from the one failure that leaves the app looking dead: a tab running an older deploy
 * than the server is still serving.
 *
 * Vercel's production alias always serves the newest deploy's file set, and every lazy chunk is
 * named by its content hash. A tab opened before a deploy has the *old* hashes baked into the
 * bundle it is already executing, so the first lazy route or `@defer` block it reaches asks for a
 * file that no longer exists. Angular's Router catches that rejection itself, emits
 * NavigationError, restores the previous URL and renders nothing — which on a first load means a
 * header, a footer, and a blank space in between where the page should be, with no error and
 * nothing to click. That is the "stale site" symptom, and it is a routing failure rather than an
 * overlay swallowing clicks.
 *
 * Two rules this file exists to keep:
 *
 *  - **The app never sits blank without saying why.** If a reload cannot fix it, `failure` is set
 *    and the shell renders a real message with a way out, instead of empty space.
 *  - **Recovery can never loop, and can never silently swallow a tap.** The marker is a timestamp
 *    with a cooldown. It is deliberately *not* cleared when a navigation succeeds: after a
 *    recovery reload the app lands on a page that renders perfectly well, and clearing on that
 *    would re-arm the reload for the very next tap on the route that is actually broken — which
 *    is the "I click and nothing happens" symptom wearing a different hat. Only time clears it.
 */

const RELOAD_MARKER = 'ojas_stale_build_reload_at';

/** One recovery reload per minute. A second failure inside that window is a genuine fault — an
 * offline phone, a chunk that really is broken — and reloading again would only flash the screen
 * at someone who needs to be told what is happening. */
const RELOAD_COOLDOWN_MS = 60_000;

/**
 * Every way a browser reports "the JavaScript file this page asked for did not arrive as
 * JavaScript". The wording differs per engine and per cause (a 404, a MIME mismatch when a
 * catch-all hands back index.html, a webpack-era chunk error), so this matches all of them rather
 * than the single Chrome phrasing.
 */
const STALE_BUILD_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading (?:CSS )?chunk .* failed/i,
  /expected a javascript(?:-or-wasm)? module script/i,
  /is not a valid JavaScript MIME type/i,
  /Unexpected token '<'/i,
];

export function isStaleBuildError(reason: unknown): boolean {
  if (!reason) return false;
  const error = reason as { name?: unknown; message?: unknown };
  if (String(error?.name ?? '') === 'ChunkLoadError') return true;

  const message = String(error?.message ?? reason);
  return STALE_BUILD_PATTERNS.some((pattern) => pattern.test(message));
}

/** sessionStorage throws outright in some privacy modes; a recovery path must not be the thing
 * that crashes the page it is trying to save. */
function readMarker(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_MARKER)) || 0;
  } catch {
    return 0;
  }
}

function writeMarker(value: number | null): void {
  try {
    if (value === null) sessionStorage.removeItem(RELOAD_MARKER);
    else sessionStorage.setItem(RELOAD_MARKER, String(value));
  } catch {
    /* Nothing to do — worst case we lose the loop guard, which the cooldown below also enforces. */
  }
}

/**
 * Takes one reload at a stale build.
 *
 * `targetUrl`, when known, is where the customer was actually trying to go, and the recovery is a
 * full page load *to that address* rather than a plain reload. That matters: a failed navigation
 * makes the Router restore the previous URL, so reloading would fetch the current build and then
 * drop the customer back on the page they had already left — their tap having apparently done
 * nothing at all. Going to the target instead fetches the current build and honours the tap.
 *
 * @returns true when a reload has been started and the caller should stop; false when recovery
 * is spent, which is the caller's cue to put something on screen.
 */
export type RecoveryDecision = 'not-stale' | 'reload' | 'give-up';

/**
 * The decision on its own, with no side effects, so the loop guard can be tested directly. Getting
 * this wrong is not a cosmetic bug: too eager and every tap becomes a silent reload back to where
 * the customer started, too reluctant and they are left staring at nothing.
 */
export function decideStaleBuildRecovery(reason: unknown, now = Date.now()): RecoveryDecision {
  if (!isStaleBuildError(reason)) return 'not-stale';

  const lastAttempt = readMarker();
  // Already tried within the cooldown: a freshly loaded copy of the app hit the same wall, so this
  // is not a stale deploy and reloading again would only flash the screen at someone who needs to
  // be told what is happening.
  if (lastAttempt && now - lastAttempt < RELOAD_COOLDOWN_MS) return 'give-up';

  return 'reload';
}

export function recoverFromStaleBuild(reason: unknown, targetUrl?: string): boolean {
  if (decideStaleBuildRecovery(reason) !== 'reload') return false;

  writeMarker(Date.now());
  if (targetUrl) window.location.assign(targetUrl);
  else window.location.reload();
  return true;
}

export interface ShellFailure {
  /** True when the app is running an older build than the server has; a reload is the whole fix. */
  staleBuild: boolean;
}

/**
 * The shell's view of whether the page it is showing is usable. Read by the root component so a
 * failed navigation produces a message and a button rather than an empty screen.
 */
@Injectable({ providedIn: 'root' })
export class AppRecoveryService {
  readonly failure = signal<ShellFailure | null>(null);

  /**
   * The deterministic channel for a lazy route that would not load. Relying on the global
   * unhandledrejection listener alone is not enough: the Router consumes that rejection on some
   * navigation paths, so the listener never fires for the exact case it was written for.
   */
  onNavigationError(reason: unknown, targetUrl?: string): void {
    if (recoverFromStaleBuild(reason, targetUrl)) return;
    this.failure.set({ staleBuild: isStaleBuildError(reason) });
  }

  /**
   * A navigation completed, so the message comes down. Note what this deliberately does *not* do:
   * clear the reload guard. After a recovery reload the app renders its landing page perfectly
   * well, and treating that as "all better" would re-arm the reload for the next tap on the route
   * that is genuinely broken — turning every tap into a silent reload back to where they started.
   * Only the cooldown lifts the guard.
   */
  onNavigationSucceeded(): void {
    if (this.failure()) this.failure.set(null);
  }

  reload(): void {
    window.location.reload();
  }
}
