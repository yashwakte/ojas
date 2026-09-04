import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DecimalPipe } from '@angular/common';
import { Product, effectivePrice, isOutOfStock, isPurchasable } from '../../models/interfaces';
import { thumbnailPackShot } from '../../constants/pack-shots';

@Component({
  selector: 'app-product-card',
  imports: [RouterLink, MatIconModule, DecimalPipe],
  templateUrl: './product-card.html',
  styleUrl: './product-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pcard',
  },
})
export class ProductCard {
  /** The shared definition, so the tile advertises exactly what the cart will charge. It used to
   * do its own arithmetic and round to whole rupees, which could differ by a few paise. */
  effectivePrice = effectivePrice;

  product = input.required<Product>();
  badge = input<string | null>(null);
  justAdded = input(false);

  addToCart = output<Product>();
  buyNow = output<Product>();

  readonly purchasable = computed(() => isPurchasable(this.product()));
  readonly outOfStock = computed(() => isOutOfStock(this.product()));

  /** The card is a couple of hundred pixels wide, so it loads the small variant rather than the
   * full-size pack shot. On a grid of thirty products that is the difference between roughly two
   * megabytes of photography and four hundred kilobytes. */
  readonly thumbnail = computed(() => thumbnailPackShot(this.product().imageUrl));

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = '/images/placeholder.svg';
  }
}
