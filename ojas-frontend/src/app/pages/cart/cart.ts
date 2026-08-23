import { Component, OnInit, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { effectivePrice } from '../../models/interfaces';
import { roundMoney } from '../../constants/pricing';

@Component({
  selector: 'app-cart',
  imports: [RouterLink, MatIconModule, DecimalPipe],
  templateUrl: './cart.html',
  styleUrl: './cart.scss',
})
export class Cart implements OnInit {
  /** Exposed to the template so each line shows what it will actually be billed at. */
  effectivePrice = effectivePrice;

  selectedIds = signal<Set<string>>(new Set<string>());

  selectedCount = computed(
    () => this.cartService.items().filter((i) => this.selectedIds().has(i.product.id)).length,
  );

  selectedTotal = computed(() =>
    roundMoney(
      this.cartService
        .items()
        .filter((i) => this.selectedIds().has(i.product.id))
        .reduce((sum, i) => sum + effectivePrice(i.product) * i.quantity, 0),
    ),
  );

  allSelected = computed(
    () =>
      this.cartService.items().length > 0 &&
      this.cartService.items().every((i) => this.selectedIds().has(i.product.id)),
  );

  constructor(
    public cartService: CartService,
    public auth: AuthService,
    private checkoutService: CheckoutService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.selectedIds.set(new Set(this.cartService.items().map((i) => i.product.id)));
  }

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  toggleSelection(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const set = new Set(this.selectedIds());
    checked ? set.add(id) : set.delete(id);
    this.selectedIds.set(set);
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedIds.set(
      checked ? new Set(this.cartService.items().map((i) => i.product.id)) : new Set<string>(),
    );
  }

  increaseQty(productId: string, currentQty: number): void {
    this.cartService.updateQuantity(productId, currentQty + 1);
  }

  decreaseQty(productId: string, currentQty: number): void {
    this.cartService.updateQuantity(productId, currentQty - 1);
  }

  removeItem(productId: string): void {
    this.cartService.removeFromCart(productId);
    const set = new Set(this.selectedIds());
    set.delete(productId);
    this.selectedIds.set(set);
  }

  proceedToCheckout(): void {
    const selectedItems = this.cartService
      .items()
      .filter((i) => this.selectedIds().has(i.product.id))
      .map((i) => ({ product: i.product, quantity: i.quantity }));
    if (selectedItems.length === 0) return;
    this.checkoutService.mergeItems(selectedItems);
    this.router.navigate(['/checkout']);
  }
}
