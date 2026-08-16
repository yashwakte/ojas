import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { CartItem, Product } from '../models/interfaces';
import { AuthService } from './auth.service';

const GUEST_KEY = 'ojas_cart_guest';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly auth = inject(AuthService);
  private readonly _items = signal<CartItem[]>([]);

  readonly items = this._items.asReadonly();

  readonly totalCount = computed(() => this._items().reduce((sum, i) => sum + i.quantity, 0));

  readonly totalAmount = computed(() =>
    this._items().reduce((sum, i) => sum + i.product.price * i.quantity, 0),
  );

  constructor() {
    // Swap buckets whenever the signed-in user changes (login / logout / account switch).
    effect(() => {
      const userId = this.auth.user()?.id ?? null;

      if (!userId) {
        this._items.set(this.read(GUEST_KEY));
        return;
      }

      // Anything added while browsing signed-out follows the customer into their
      // account, so a guest never loses a cart by logging in at checkout.
      const guestItems = this.read(GUEST_KEY);
      const ownItems = this.read(this.userKey(userId));

      if (guestItems.length) {
        this._items.set(mergeCarts(ownItems, guestItems));
        localStorage.removeItem(GUEST_KEY);
        localStorage.setItem(this.userKey(userId), JSON.stringify(this._items()));
      } else {
        this._items.set(ownItems);
      }
    });
  }

  addToCart(product: Product): void {
    const current = this._items();
    const existing = current.find((i) => i.product.id === product.id);
    if (existing) {
      this._items.set(
        current.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)),
      );
    } else {
      this._items.set([...current, { product, quantity: 1 }]);
    }
    this.save();
  }

  removeFromCart(productId: string): void {
    this._items.set(this._items().filter((i) => i.product.id !== productId));
    this.save();
  }

  updateQuantity(productId: string, quantity: number): void {
    if (quantity < 1) {
      this.removeFromCart(productId);
      return;
    }
    this._items.set(
      this._items().map((i) => (i.product.id === productId ? { ...i, quantity } : i)),
    );
    this.save();
  }

  clearCart(): void {
    this._items.set([]);
    localStorage.removeItem(this.storageKey());
  }

  private userKey(userId: string): string {
    return `ojas_cart_${userId}`;
  }

  /** Guests persist to their own bucket so the cart survives a page reload. */
  private storageKey(): string {
    const userId = this.auth.user()?.id;
    return userId ? this.userKey(userId) : GUEST_KEY;
  }

  private save(): void {
    localStorage.setItem(this.storageKey(), JSON.stringify(this._items()));
  }

  private read(key: string): CartItem[] {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
      return [];
    }
  }
}

/** Quantities add up when a guest cart is absorbed into an account cart. */
function mergeCarts(base: CartItem[], incoming: CartItem[]): CartItem[] {
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
