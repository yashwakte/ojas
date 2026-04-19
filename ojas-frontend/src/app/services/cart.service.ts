import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { CartItem, Product } from '../models/interfaces';
import { AuthService } from './auth.service';

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
    // Reload cart whenever the logged-in user changes (login / logout / account switch)
    effect(() => {
      const user = this.auth.user();
      this._items.set(user ? this.load(user.email) : []);
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
    const email = this.auth.user()?.email;
    if (email) localStorage.removeItem(this.key(email));
  }

  private key(email: string): string {
    return `ojas_cart_${email}`;
  }

  private save(): void {
    const email = this.auth.user()?.email;
    if (email) localStorage.setItem(this.key(email), JSON.stringify(this._items()));
  }

  private load(email: string): CartItem[] {
    try {
      const raw = localStorage.getItem(this.key(email));
      return raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
      return [];
    }
  }
}
