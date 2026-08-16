import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { OrderEditDraftService } from '../../services/order-edit-draft.service';

/**
 * Shown on Products / product-detail while the customer is off adding items
 * to an order they're editing. Gives them a clear way back — otherwise
 * "picking mode" would silently swap what Add to Cart does with no
 * indication why, or how to return.
 */
@Component({
  selector: 'app-order-picking-banner',
  imports: [MatIconModule],
  templateUrl: './order-picking-banner.html',
  styleUrl: './order-picking-banner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderPickingBanner {
  private readonly router = inject(Router);
  protected readonly draft = inject(OrderEditDraftService);

  done(): void {
    this.router.navigate(['/my-orders']);
  }
}
