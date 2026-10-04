import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CartStepper } from './cart-stepper';
import { CartService } from '../../services/cart.service';
import { OrderEditDraftService } from '../../services/order-edit-draft.service';
import { Product } from '../../models/interfaces';

describe('CartStepper', () => {
  const product: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: '',
    price: 45,
    discount: 0,
    category: 'Everyday Flours',
    imageUrl: '',
    galleryImageUrls: [],
    weight: '500g',
    isAvailable: true,
    isListed: true,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: '',
    benefits: '',
    storageInfo: '',
    createdAt: '',
    updatedAt: '',
  };

  @Component({
    imports: [CartStepper],
    template: `
      <app-cart-stepper [product]="product()">
        <button type="button" class="add" (click)="add()">Add</button>
      </app-cart-stepper>
    `,
  })
  class Host {
    readonly product = signal(product);
    add(): void {
      quantity.update((n) => n + 1);
    }
  }

  let quantity: ReturnType<typeof signal<number>>;
  let picking: ReturnType<typeof signal<boolean>>;
  let updateQuantity: jasmine.Spy;

  beforeEach(() => {
    quantity = signal(0);
    picking = signal(false);
    updateQuantity = jasmine.createSpy('updateQuantity');
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: CartService, useValue: { quantityOf: () => quantity(), updateQuantity } },
        { provide: OrderEditDraftService, useValue: { picking: computed(() => picking()) } },
      ],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  const el = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement;

  it("shows the page's own Add button while the product is not in the cart", () => {
    const fixture = create();
    expect(el(fixture).querySelector('.add')).not.toBeNull();
    expect(el(fixture).querySelector('.qty-stepper')).toBeNull();
  });

  it('swaps to the count once the product is in the cart', () => {
    const fixture = create();
    quantity.set(3);
    fixture.detectChanges();

    expect(el(fixture).querySelector('.add')).toBeNull();
    expect(el(fixture).querySelector('.qty-num')?.textContent?.trim()).toBe('3');
  });

  it('keeps the Add button while picking for an order edit', () => {
    picking.set(true);
    quantity.set(3);
    const fixture = create();
    expect(el(fixture).querySelector('.add')).not.toBeNull();
  });

  it('+ and - change the cart quantity, and - at one removes it', () => {
    quantity.set(1);
    const fixture = create();
    const [minus, plus] = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.qty-btn'));

    plus.click();
    expect(updateQuantity).toHaveBeenCalledWith('p1', 2);
    minus.click();
    expect(updateQuantity).toHaveBeenCalledWith('p1', 0);
  });

  it('+ stops at the units on hand', () => {
    quantity.set(2);
    const fixture = create();
    fixture.componentInstance.product.set({ ...product, stockQuantity: 2 });
    fixture.detectChanges();

    const plus = el(fixture).querySelector<HTMLButtonElement>('.qty-plus')!;
    expect(plus.disabled).toBeTrue();
  });

  it('moves focus from the Add button to + after adding', async () => {
    const fixture = create();
    document.body.appendChild(el(fixture));
    const add = el(fixture).querySelector<HTMLButtonElement>('.add')!;
    add.focus();
    add.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(el(fixture).querySelector('.qty-plus'));
    el(fixture).remove();
  });
});
