import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { EMPTY, Observable, from } from 'rxjs';

/**
 * When each lazy route's code is fetched.
 *
 * Every route in this app is `loadComponent`, which is right for the first paint — a customer
 * landing on the home page should not download the checkout, the admin console and the order
 * history to see it. It is wrong for the second paint. Without a preloading strategy the chunk
 * for /products, /cart or a product page is not requested until the moment it is clicked, so
 * every first visit to a screen costs a network round trip before a single pixel of it can be
 * drawn — on a phone on mobile data, several hundred milliseconds of a page that looks stuck.
 * That is the "clicking products takes too long" and "cart navigation is slow" complaint: not the
 * page being slow to render, the page not having arrived yet.
 *
 * So the storefront is fetched ahead of being asked for, but only once the browser has nothing
 * better to do, and never at the expense of the page already on screen:
 *
 *  - it waits for the browser to report itself idle, so preloading competes with nothing that the
 *    customer is currently looking at, and never with the first screenful's own images;
 *  - it respects Data Saver and slow connections, where spending a megabyte on screens somebody
 *    may not visit is a cost rather than a saving;
 *  - it only preloads what a route asks for. Marking a route is opt-in (`data.preload`), which
 *    keeps the admin console — by a wide margin the largest chunk in the build — off the wire for
 *    the customers who make up essentially all the traffic.
 *
 * The result is that the second and every subsequent navigation is a signal write and a render,
 * with nothing fetched at click time at all.
 */
@Injectable({ providedIn: 'root' })
export class StorefrontPreloadStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (route.data?.['preload'] !== true) return EMPTY;
    if (!shouldPreload()) return EMPTY;
    return from(whenIdle().then(() => load()));
  }
}

/**
 * Whether this connection can afford to fetch screens the customer has not asked for.
 *
 * The Network Information API is not available everywhere, and its absence is not a reason to
 * hold back — the overwhelming majority of connections are fine and the default has to serve
 * them. It is only consulted to opt OUT: Data Saver switched on is an explicit request not to
 * spend bandwidth speculatively, and 2g is a connection where a speculative megabyte would delay
 * the page the customer is actually reading.
 */
function shouldPreload(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

/** How long to wait for an idle moment before preloading anyway. Long enough that the first
 * screenful — its data, its fonts and its photography — is comfortably done on a slow phone. */
const IDLE_TIMEOUT_MS = 3000;

/**
 * Resolves the moment the browser is idle, or after IDLE_TIMEOUT_MS, whichever comes first.
 *
 * `requestIdleCallback` is the whole point: it is what guarantees this work happens in the gaps
 * rather than in front of anything. Safari has only recently supported it, so a timeout stands in
 * where it is missing — the fallback is deliberately generous rather than immediate, because the
 * failure mode being avoided is preloading racing the first paint.
 */
function whenIdle(): Promise<void> {
  const idle = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;

  if (!idle) return new Promise((resolve) => setTimeout(resolve, IDLE_TIMEOUT_MS));
  return new Promise((resolve) => idle(() => resolve(), { timeout: IDLE_TIMEOUT_MS }));
}
