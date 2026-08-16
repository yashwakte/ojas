import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Product } from '../models/interfaces';
import { AuthService } from './auth.service';

export interface CheckoutItem {
  product: Product;
  quantity: number;
}

const GUEST_KEY = 'ojas_checkout_guest';

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private readonly auth = inject(AuthService);
  private readonly _items = signal<CheckoutItem[]>([]);

  readonly items = this._items.asReadonly();
  readonly count = computed(() => this._items().length);

  constructor() {
    // Reload checkout whenever the logged-in user changes (login / logout / account switch)
    effect(() => {
      const userId = this.auth.user()?.id ?? null;

      if (!userId) {
        this._items.set(this.read(GUEST_KEY));
        return;
      }

      // A guest who hit "Buy Now" and then signed in at the gate finds their
      // selection still waiting for them on the checkout page.
      const guestItems = this.read(GUEST_KEY);
      const ownItems = this.read(this.userKey(userId));

      if (guestItems.length) {
        this._items.set(mergeCheckout(ownItems, guestItems));
        localStorage.removeItem(GUEST_KEY);
        localStorage.setItem(this.userKey(userId), JSON.stringify(this._items()));
      } else {
        this._items.set(ownItems);
      }
    });
  }

  addItem(product: Product, quantity = 1): void {
    const current = this._items();
    const existing = current.find((i) => i.product.id === product.id);
    if (existing) {
      this._items.set(
        current.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + quantity } : i,
        ),
      );
    } else {
      this._items.set([...current, { product, quantity }]);
    }
    this.save();
  }

  mergeItems(items: CheckoutItem[]): void {
    const current = [...this._items()];
    for (const item of items) {
      const idx = current.findIndex((i) => i.product.id === item.product.id);
      if (idx >= 0) {
        current[idx] = { ...current[idx], quantity: item.quantity };
      } else {
        current.push({ ...item });
      }
    }
    this._items.set(current);
    this.save();
  }

  updateQuantity(productId: string, quantity: number): void {
    this._items.set(
      this._items().map((i) => (i.product.id === productId ? { ...i, quantity } : i)),
    );
    this.save();
  }

  removeItem(productId: string): void {
    this._items.set(this._items().filter((i) => i.product.id !== productId));
    this.save();
  }

  clear(): void {
    this._items.set([]);
    localStorage.removeItem(this.storageKey());
  }

  private userKey(userId: string): string {
    return `ojas_checkout_${userId}`;
  }

  /** Guests persist to their own bucket so "Buy Now" survives the login redirect. */
  private storageKey(): string {
    const userId = this.auth.user()?.id;
    return userId ? this.userKey(userId) : GUEST_KEY;
  }

  private save(): void {
    localStorage.setItem(this.storageKey(), JSON.stringify(this._items()));
  }

  private read(key: string): CheckoutItem[] {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as CheckoutItem[]) : [];
    } catch {
      return [];
    }
  }
}

function mergeCheckout(base: CheckoutItem[], incoming: CheckoutItem[]): CheckoutItem[] {
  const merged = [...base];
  for (const item of incoming) {
    const idx = merged.findIndex((i) => i.product.id === item.product.id);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], quantity: merged[idx].quantity + item.quantity };
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}
