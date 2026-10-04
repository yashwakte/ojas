import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Product, isPurchasable } from '../../models/interfaces';
import { CartService } from '../../services/cart.service';
import { OrderEditDraftService } from '../../services/order-edit-draft.service';

/**
 * Wraps a product tile's Add button. While the product is not in the cart it shows that button
 * (projected, so each page keeps its own look); once it is, the button gives way to a
 * "- 3 in cart +" stepper so more can be added, or some taken back, without leaving the grid.
 *
 * Shows the button unchanged while picking products for an order edit: those adds go to the
 * order's draft, not the cart, and the cart's count would be the wrong number.
 */
@Component({
  selector: 'app-cart-stepper',
  imports: [MatIconModule],
  templateUrl: './cart-stepper.html',
  styleUrl: './cart-stepper.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(click)': 'onClick($event)',
  },
})
export class CartStepper {
  private readonly cart = inject(CartService);
  private readonly orderEditDraft = inject(OrderEditDraftService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly product = input.required<Product>();

  readonly quantity = computed(() =>
    this.orderEditDraft.picking() ? 0 : this.cart.quantityOf(this.product().id),
  );

  /** "+" stops at the units on hand when stock is tracked - checkout would refuse the rest. */
  readonly canAddMore = computed(() => {
    const p = this.product();
    return isPurchasable(p) && (p.stockQuantity === null || this.quantity() < p.stockQuantity);
  });

  change(delta: 1 | -1): void {
    if (delta > 0 && !this.canAddMore()) return;
    this.cart.updateQuantity(this.product().id, this.quantity() + delta);
  }

  /**
   * The page's own handler has already added the product by the time its click bubbles here, so
   * the focused Add button is about to be removed. Hand focus to the stepper's "+" instead of
   * letting the keyboard drop back to the top of the page.
   */
  onClick(event: Event): void {
    const button = (event.target as Element).closest('button');
    if (!button || button.closest('.qty-stepper') || button !== document.activeElement) return;
    if (this.quantity() === 0) return;
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('.qty-plus')?.focus(),
      { injector: this.injector },
    );
  }
}
