import { Injectable, computed, signal } from '@angular/core';
import { OrderItem, Product, effectivePrice } from '../models/interfaces';

export interface OrderEditDraft {
  orderId: string;
  items: OrderItem[];
}

/**
 * Bridges the "add more products" step of editing an order across a trip to
 * the Products / product-detail pages and back. my-orders can't hold this in
 * its own component state because navigating away destroys and recreates
 * that component — this service is the one thing that survives the round
 * trip, so my-orders can resume the edit exactly where it left off.
 */
@Injectable({ providedIn: 'root' })
export class OrderEditDraftService {
  private readonly _draft = signal<OrderEditDraft | null>(null);
  private readonly _pickedCount = signal(0);

  readonly draft = this._draft.asReadonly();
  readonly picking = computed(() => this._draft() !== null);
  /** How many times "Add" was tapped this trip — drives the "N added" badge. */
  readonly pickedCount = this._pickedCount.asReadonly();

  begin(orderId: string, items: OrderItem[]): void {
    this._draft.set({ orderId, items: items.map((i) => ({ ...i })) });
    this._pickedCount.set(0);
  }

  addProduct(product: Product, quantity = 1): void {
    this._draft.update((d) => {
      if (!d) return d;
      // The shared definition, so this agrees with the cart, checkout and the server.
      const price = effectivePrice(product);
      const existing = d.items.find((i) => i.productId === product.id);
      const items = existing
        ? d.items.map((i) =>
            i.productId === product.id ? { ...i, quantity: i.quantity + quantity } : i,
          )
        : [
            ...d.items,
            { productId: product.id, productName: product.name, price, weight: product.weight, quantity },
          ];
      return { ...d, items };
    });
    this._pickedCount.update((n) => n + 1);
  }

  clear(): void {
    this._draft.set(null);
    this._pickedCount.set(0);
  }
}
