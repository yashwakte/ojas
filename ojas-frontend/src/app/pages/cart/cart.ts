import { Component, OnInit, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { QuantitySheet } from '../../components/quantity-sheet/quantity-sheet';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { Product, deliveryBetweenLabel, effectivePrice } from '../../models/interfaces';
import { roundMoney } from '../../constants/pricing';

@Component({
  selector: 'app-cart',
  imports: [RouterLink, MatIconModule, DecimalPipe, QuantitySheet],
  templateUrl: './cart.html',
  styleUrl: './cart.scss',
})
export class Cart implements OnInit {
  /** Exposed to the template so each line shows what it will actually be billed at. */
  effectivePrice = effectivePrice;

  /** Computed once per render rather than per line: every item in the basket ships together, so
   * thirteen identical date strings would be thirteen identical calculations. */
  readonly deliveryWindowLabel = deliveryBetweenLabel();

  /** What the discount is worth in rupees, which is what a shopper actually compares. Null when
   * there is no discount, so the line simply isn't drawn rather than showing "₹0 Off". */
  savingOn(product: Product): number | null {
    const saved = roundMoney(product.price - effectivePrice(product));
    return saved > 0 ? saved : null;
  }

  /** The line whose quantity sheet is open, if any. Held by product id rather than by index so
   * removing another line while it is open can't hand the sheet a different product. */
  readonly quantitySheetFor = signal<string | null>(null);

  readonly quantitySheetItem = computed(() => {
    const id = this.quantitySheetFor();
    return id ? (this.cartService.items().find((i) => i.product.id === id) ?? null) : null;
  });

  openQuantitySheet(productId: string): void {
    this.quantitySheetFor.set(productId);
  }

  closeQuantitySheet(): void {
    this.quantitySheetFor.set(null);
  }

  setQuantity(productId: string, quantity: number): void {
    this.cartService.updateQuantity(productId, quantity);
    this.closeQuantitySheet();
  }

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
