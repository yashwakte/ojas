import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, finalize, map, of, shareReplay } from 'rxjs';
import { environment } from '../../environments/environment';
import { Product } from '../models/interfaces';
import { AuthService } from './auth.service';
import { ProductService } from './product.service';

export interface BasketLine {
  product: Product;
  quantity: number;
}

/** The two lists a customer keeps: the cart itself, and the lines chosen for checkout. */
export type BasketList = 'items' | 'checkout';

export interface ServerBasket {
  items: BasketLine[];
  checkoutItems: BasketLine[];
  /** Null when the server has never held a basket for this account. */
  updatedAt: string | null;
}

/** Long enough to fold a burst of + presses into one save, short enough that a customer who
 * adds something and reaches for their other device finds it already there. */
export const BASKET_SAVE_DEBOUNCE_MS = 400;

interface PendingSave {
  userId: string;
  lines: BasketLine[];
}

interface ListState {
  timer: ReturnType<typeof setTimeout> | null;
  sending: boolean;
  queued: PendingSave | null;
}

/**
 * The server copy of a signed-in customer's cart and checkout selection.
 *
 * The basket used to live only in this browser's localStorage, so it belonged to the device
 * rather than to the customer: whatever they put in the cart on their phone was simply not there
 * when they signed in on a laptop. The server is now the record for anyone signed in, and the
 * local copy is only a cache that lets the page draw immediately while the real one is fetched.
 * SyncedBasket holds the rules for reconciling the two; this is only the transport.
 *
 * Writes replace a whole list and are debounced and strictly sequential per list. Sequential
 * matters as much as debounced: two saves racing each other could land in the wrong order, and
 * the older basket would win.
 */
@Injectable({ providedIn: 'root' })
export class BasketSyncService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly products = inject(ProductService);
  private readonly apiUrl = `${environment.apiUrl}/cart`;

  private inFlightLoad: { userId: string; request: Observable<ServerBasket | null> } | null = null;

  private readonly lists: Record<BasketList, ListState> = {
    items: { timer: null, sending: false, queued: null },
    checkout: { timer: null, sending: false, queued: null },
  };

  constructor() {
    // A save still waiting out its debounce when the tab is hidden or closed would otherwise be
    // lost with the page. Hidden fires before unload on every browser, including a phone
    // switching apps, so this is the last reliable moment to send it.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushOnHide();
      });
    }
  }

  /**
   * The account's basket as the server holds it, or null if it could not be fetched. One request
   * is shared by whoever asks while it is in flight - the cart and checkout services both ask the
   * moment a customer signs in, and would otherwise make two identical calls.
   */
  load(userId: string): Observable<ServerBasket | null> {
    if (this.inFlightLoad?.userId === userId) return this.inFlightLoad.request;

    const request: Observable<ServerBasket | null> = this.http.get<ServerBasket>(this.apiUrl).pipe(
      map((basket) => ({
        items: this.normalize(basket.items),
        checkoutItems: this.normalize(basket.checkoutItems),
        updatedAt: basket.updatedAt ?? null,
      })),
      // Failing to fetch is not the same as an empty basket. Callers get null and must keep what
      // they already show rather than wipe it.
      catchError(() => of(null)),
      finalize(() => {
        if (this.inFlightLoad?.request === request) this.inFlightLoad = null;
      }),
      shareReplay(1),
    );

    this.inFlightLoad = { userId, request };
    return request;
  }

  /** Queues the list to be saved for this account. Only the latest queued version is ever sent. */
  save(list: BasketList, userId: string, lines: readonly BasketLine[]): void {
    const state = this.lists[list];
    state.queued = { userId, lines: [...lines] };
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      this.send(list);
    }, BASKET_SAVE_DEBOUNCE_MS);
  }

  /** True while this tab has a change to this list that the server has not confirmed yet - the
   * one time a fresh copy from the server must not be allowed to replace what is on screen. */
  hasPending(list: BasketList): boolean {
    const state = this.lists[list];
    return state.timer !== null || state.sending || state.queued !== null;
  }

  private send(list: BasketList): void {
    const state = this.lists[list];
    if (state.sending || !state.queued) return;

    const { userId, lines } = state.queued;
    state.queued = null;

    // Written for one account, and this tab now belongs to another (or to nobody). Sending it
    // would put the first customer's basket into the second one's cart.
    if (this.auth.user()?.id !== userId) return;

    state.sending = true;
    this.http
      .put(`${this.apiUrl}/${list}`, { items: toRequestLines(lines) })
      .pipe(
        finalize(() => {
          state.sending = false;
          // Anything queued while this was in flight goes next, never alongside it.
          this.send(list);
        }),
      )
      .subscribe({ error: () => {} });
  }

  /**
   * Sends whatever is still waiting, as a keepalive request the browser completes even if the
   * page is going away. HttpClient cannot do that, so this is plain fetch carrying the same
   * credentials and CSRF header the interceptor would have added.
   */
  private flushOnHide(): void {
    for (const list of Object.keys(this.lists) as BasketList[]) {
      const state = this.lists[list];
      if (state.timer === null || !state.queued) continue;

      clearTimeout(state.timer);
      state.timer = null;

      const { userId, lines } = state.queued;
      state.queued = null;
      if (this.auth.user()?.id !== userId) continue;

      const csrf = this.auth.getCsrfToken();
      try {
        void fetch(`${this.apiUrl}/${list}`, {
          method: 'PUT',
          keepalive: true,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: JSON.stringify({ items: toRequestLines(lines) }),
        }).catch(() => {});
      } catch {
        // Nothing more can be done for a page that is already leaving.
      }
    }
  }

  private normalize(lines: BasketLine[] | null | undefined): BasketLine[] {
    return (lines ?? []).map((line) => ({
      product: this.products.normalizeProduct(line.product),
      quantity: line.quantity,
    }));
  }
}

function toRequestLines(lines: readonly BasketLine[]) {
  return lines.map((line) => ({ productId: line.product.id, quantity: line.quantity }));
}

/** True when two lists hold the same products at the same quantities, in any order. */
export function sameLines(a: readonly BasketLine[], b: readonly BasketLine[]): boolean {
  if (a.length !== b.length) return false;
  const quantities = new Map(a.map((line) => [line.product.id, line.quantity]));
  return b.every((line) => quantities.get(line.product.id) === line.quantity);
}
