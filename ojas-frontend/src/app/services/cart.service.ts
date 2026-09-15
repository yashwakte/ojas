import { Injectable, Signal, computed, inject } from '@angular/core';
import { CartItem, Product, effectivePrice } from '../models/interfaces';
import { roundMoney } from '../constants/pricing';
import { AuthService } from './auth.service';
import { BasketSyncService } from './basket-sync.service';
import { SyncedBasket } from './synced-basket';

/**
 * The customer's cart. For a signed-in customer the server holds it, so it is the same cart on
 * every device they use; signed out, it lives in this browser until they sign in, when it is
 * merged into their account's. SyncedBasket holds the rules for keeping the two in step, and
 * swaps buckets whenever the signed-in user changes (login / logout / account switch).
 */
@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly basket = new SyncedBasket(
    { list: 'items', storagePrefix: 'ojas_cart' },
    inject(AuthService),
    inject(BasketSyncService),
  );

  readonly items: Signal<CartItem[]> = this.basket.lines;

  /** False while a signed-in customer's cart is still on its way from the server. */
  readonly ready = this.basket.ready;

  readonly totalCount = computed(() => this.items().reduce((sum, i) => sum + i.quantity, 0));

  /** Priced at what the customer will actually be charged, discount included. */
  readonly totalAmount = computed(() =>
    roundMoney(this.items().reduce((sum, i) => sum + effectivePrice(i.product) * i.quantity, 0)),
  );

  addToCart(product: Product): void {
    this.basket.change((items) =>
      items.some((i) => i.product.id === product.id)
        ? items.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...items, { product, quantity: 1 }],
    );
  }

  removeFromCart(productId: string): void {
    this.basket.change((items) => items.filter((i) => i.product.id !== productId));
  }

  updateQuantity(productId: string, quantity: number): void {
    if (quantity < 1) {
      this.removeFromCart(productId);
      return;
    }
    this.basket.change((items) =>
      items.map((i) => (i.product.id === productId ? { ...i, quantity } : i)),
    );
  }

  clearCart(): void {
    this.basket.change(() => []);
  }
}
