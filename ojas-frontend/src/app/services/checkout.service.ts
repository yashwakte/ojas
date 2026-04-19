import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Product } from '../models/interfaces';
import { AuthService } from './auth.service';

export interface CheckoutItem {
  product: Product;
  quantity: number;
}

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private readonly auth = inject(AuthService);
  private readonly _items = signal<CheckoutItem[]>([]);

  readonly items = this._items.asReadonly();
  readonly count = computed(() => this._items().length);

  constructor() {
    // Reload checkout whenever the logged-in user changes (login / logout / account switch)
    effect(() => {
      const user = this.auth.user();
      this._items.set(user ? this.load(user.email) : []);
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
    const email = this.auth.user()?.email;
    if (email) localStorage.removeItem(this.key(email));
  }

  private key(email: string): string {
    return `ojas_checkout_${email}`;
  }

  private save(): void {
    const email = this.auth.user()?.email;
    if (email) localStorage.setItem(this.key(email), JSON.stringify(this._items()));
  }

  private load(email: string): CheckoutItem[] {
    try {
      const raw = localStorage.getItem(this.key(email));
      return raw ? (JSON.parse(raw) as CheckoutItem[]) : [];
    } catch {
      return [];
    }
  }
}
