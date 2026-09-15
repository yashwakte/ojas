import { computed, effect, signal, untracked } from '@angular/core';
import { AuthService } from './auth.service';
import { BasketLine, BasketList, BasketSyncService, sameLines } from './basket-sync.service';

/** How long a tab may go without re-reading the server copy when it comes back into view. */
export const BASKET_REFRESH_AFTER_MS = 30_000;

type BasketChange = (lines: BasketLine[]) => BasketLine[];

export interface SyncedBasketOptions {
  list: BasketList;
  /** `${prefix}_guest` holds a signed-out visitor's lines; `${prefix}_${userId}` caches an account's. */
  storagePrefix: string;
}

/**
 * One of a customer's two basket lists - the cart, or the checkout selection - kept in step with
 * the server copy while a customer is signed in (see BasketSyncService for why there is one).
 *
 * The rules, because each one exists to stop a basket being silently lost:
 *
 * - The page draws at once from this browser's cached copy, then the server's copy replaces it.
 *   The server is the record; the cache is only there so the page is never blank while it loads.
 * - A change made before the server's copy has arrived is applied on screen and also queued, then
 *   replayed onto the server's copy when it lands. Saving straight away would overwrite whatever
 *   the customer put in the basket on another device with this device's older view of it.
 * - If the server cannot be reached, what is on screen stays and changes keep queuing. Failing to
 *   fetch is not the same as an empty basket.
 * - An account the server has never held a basket for is one whose basket, until now, lived only
 *   in this browser. The cached copy is adopted rather than replaced by an empty one, so the first
 *   sign-in after this shipped does not empty every existing customer's cart.
 * - A signed-out visitor's lines follow them into their account when they sign in.
 */
export class SyncedBasket {
  private readonly _lines = signal<BasketLine[]>([]);
  private readonly _ready = signal(true);

  /** The account this list is server-backed for, while a customer is signed in. */
  private serverBackedFor: string | null = null;
  /** The account whose server copy this list has been reconciled with. */
  private syncedFor: string | null = null;
  private queued: BasketChange[] = [];
  private cachedAtSignIn: BasketLine[] = [];
  private lastFetchedAt = 0;

  readonly lines = this._lines.asReadonly();
  /** False while a signed-in customer's list is still on its way from the server. */
  readonly ready = this._ready.asReadonly();

  /**
   * Must be constructed in an injection context (a service's field initialiser), because it
   * follows the signed-in account with an effect.
   */
  constructor(
    private readonly options: SyncedBasketOptions,
    private readonly auth: AuthService,
    private readonly sync: BasketSyncService,
  ) {
    // Watches a computed of the account rather than the user object itself: the user object is
    // replaced on every silent token refresh, and each of those would otherwise refetch the basket.
    const owner = computed(
      () => {
        const user = auth.user();
        return user ? { id: user.id, isCustomer: user.role === 'customer' } : null;
      },
      { equal: (a, b) => a?.id === b?.id && a?.isCustomer === b?.isCustomer },
    );
    effect(() => {
      const current = owner();
      untracked(() => this.switchTo(current?.id ?? null, current?.isCustomer ?? false));
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.refreshFromServer();
      });
    }
  }

  /**
   * Called whenever who is signed in changes. `serverBacked` is false for signed-out visitors and
   * for staff accounts, which never shop.
   */
  switchTo(userId: string | null, serverBacked: boolean): void {
    this.serverBackedFor = null;
    this.syncedFor = null;
    this.queued = [];

    if (!userId) {
      this._ready.set(true);
      this._lines.set(this.read(this.guestKey));
      return;
    }

    const guest = this.read(this.guestKey);
    this.cachedAtSignIn = this.read(this.userKey(userId));
    this._lines.set(guest.length ? mergeLines(this.cachedAtSignIn, guest) : this.cachedAtSignIn);

    if (!serverBacked) {
      this.retireGuestLines(userId);
      this._ready.set(true);
      return;
    }

    this.serverBackedFor = userId;
    this._ready.set(false);
    this.fetch(userId);
  }

  /** Applies a change on screen at once, and to the server copy as soon as it is safe to. */
  change(fn: BasketChange): void {
    this._lines.update(fn);
    if (this.serverBackedFor && this.syncedFor !== this.serverBackedFor) this.queued.push(fn);
    this.persist();
  }

  /**
   * Re-reads the server copy, at most once every BASKET_REFRESH_AFTER_MS. Called when a tab comes
   * back into view - one left open while the customer used another device would otherwise go on
   * showing the basket as it was - and it is also the retry after a fetch that failed.
   */
  refreshFromServer(now = Date.now()): void {
    const userId = this.serverBackedFor;
    if (!userId || now - this.lastFetchedAt < BASKET_REFRESH_AFTER_MS) return;
    if (this.sync.hasPending(this.options.list)) return;
    this.fetch(userId);
  }

  private fetch(userId: string): void {
    this.lastFetchedAt = Date.now();
    this.sync.load(userId).subscribe((server) => {
      // Signed out, or somebody else signed in, while this was in flight.
      if (this.serverBackedFor !== userId) return;
      this._ready.set(true);
      if (!server) return;

      // A change of this tab's own is still on its way to the server. The copy that just arrived
      // predates it, so it must not replace what is on screen.
      if (this.syncedFor === userId && this.sync.hasPending(this.options.list)) return;

      const firstSync = this.syncedFor !== userId;
      const serverLines = this.options.list === 'items' ? server.items : server.checkoutItems;

      let next = firstSync && !server.updatedAt ? this.cachedAtSignIn : serverLines;
      if (firstSync) {
        const guest = this.read(this.guestKey);
        if (guest.length) next = mergeLines(next, guest);
        for (const change of this.queued) next = change(next);
        this.queued = [];
      }

      this.syncedFor = userId;
      this._lines.set(next);
      this.retireGuestLines(userId);
      if (!sameLines(next, serverLines)) this.sync.save(this.options.list, userId, next);
    });
  }

  private get guestKey(): string {
    return `${this.options.storagePrefix}_guest`;
  }

  private userKey(userId: string): string {
    return `${this.options.storagePrefix}_${userId}`;
  }

  /** The guest's lines belong to the account now. Emptying the guest bucket is what stops them
   * being merged in a second time on the next sign-in. */
  private retireGuestLines(userId: string): void {
    this.remove(this.guestKey);
    this.writeCache(this.userKey(userId), this._lines());
  }

  private persist(): void {
    const userId = this.auth.user()?.id ?? null;
    this.writeCache(userId ? this.userKey(userId) : this.guestKey, this._lines());
    if (this.serverBackedFor && this.syncedFor === this.serverBackedFor) {
      this.sync.save(this.options.list, this.serverBackedFor, this._lines());
    }
  }

  private writeCache(key: string, lines: BasketLine[]): void {
    try {
      if (lines.length) localStorage.setItem(key, JSON.stringify(lines));
      else localStorage.removeItem(key);
    } catch {
      // Storage full or unavailable. The basket still works for this page; it just won't be
      // drawn from cache next time.
    }
  }

  private remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing stored to remove.
    }
  }

  private read(key: string): BasketLine[] {
    try {
      const raw = localStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as BasketLine[]) : [];
    } catch {
      return [];
    }
  }
}

/** Quantities add up when a signed-out visitor's lines are folded into an account's. */
function mergeLines(base: BasketLine[], incoming: BasketLine[]): BasketLine[] {
  const merged = [...base];
  for (const line of incoming) {
    const idx = merged.findIndex((l) => l.product.id === line.product.id);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], quantity: merged[idx].quantity + line.quantity };
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}
