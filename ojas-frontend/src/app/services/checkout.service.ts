import { Injectable, Signal, computed, inject } from '@angular/core';
import { Product } from '../models/interfaces';
import { AuthService } from './auth.service';
import { BasketSyncService } from './basket-sync.service';
import { SyncedBasket } from './synced-basket';

export interface CheckoutItem {
  product: Product;
  quantity: number;
}

/**
 * The lines chosen for checkout - by "Buy Now", or by "Checkout selected" on the cart. Kept on
 * the server alongside the cart for a signed-in customer, so a checkout started on one device is
 * still waiting on the next; a guest who hit "Buy Now" and then signed in at the gate finds their
 * selection still there. See SyncedBasket.
 */
@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private readonly basket = new SyncedBasket(
    { list: 'checkout', storagePrefix: 'ojas_checkout' },
    inject(AuthService),
    inject(BasketSyncService),
  );

  readonly items: Signal<CheckoutItem[]> = this.basket.lines;
  readonly count = computed(() => this.items().length);

  /** False while a signed-in customer's selection is still on its way from the server. The
   * checkout page waits for this before deciding there is nothing to check out. */
  readonly ready = this.basket.ready;

  addItem(product: Product, quantity = 1): void {
    this.basket.change((current) =>
      current.some((i) => i.product.id === product.id)
        ? current.map((i) =>
            i.product.id === product.id ? { ...i, quantity: i.quantity + quantity } : i,
          )
        : [...current, { product, quantity }],
    );
  }

  mergeItems(items: CheckoutItem[]): void {
    this.basket.change((current) => {
      const merged = [...current];
      for (const item of items) {
        const idx = merged.findIndex((i) => i.product.id === item.product.id);
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], quantity: item.quantity };
        } else {
          merged.push({ ...item });
        }
      }
      return merged;
    });
  }

  updateQuantity(productId: string, quantity: number): void {
    this.basket.change((current) =>
      current.map((i) => (i.product.id === productId ? { ...i, quantity } : i)),
    );
  }

  removeItem(productId: string): void {
    this.basket.change((current) => current.filter((i) => i.product.id !== productId));
  }

  clear(): void {
    this.basket.change(() => []);
  }
}
