import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DecimalPipe } from '@angular/common';
import { Product } from '../../models/interfaces';

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
  product = input.required<Product>();
  badge = input<string | null>(null);
  justAdded = input(false);

  addToCart = output<Product>();
  buyNow = output<Product>();

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = '/images/placeholder.svg';
  }
}
