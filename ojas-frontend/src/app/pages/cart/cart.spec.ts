import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { Cart } from './cart';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { CartItem, Product, effectivePrice } from '../../models/interfaces';

describe('Cart', () => {
  const product: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'desc',
    price: 100,
    discount: 0,
    category: 'Flour',
    imageUrl: '',
    galleryImageUrls: [],
    weight: '500g',
    isAvailable: true,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: '',
    benefits: '',
    storageInfo: '',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
  const product2: Product = { ...product, id: 'p2', price: 50 };

  let items: ReturnType<typeof signal<CartItem[]>>;
  let cartServiceSpy: any;
  let checkoutServiceSpy: jasmine.SpyObj<CheckoutService>;
  let router: Router;

  beforeEach(() => {
    items = signal<CartItem[]>([
      { product, quantity: 2 },
      { product: product2, quantity: 1 },
    ]);
    cartServiceSpy = jasmine.createSpyObj('CartService', ['updateQuantity', 'removeFromCart'], {
      items,
      totalCount: () => items().reduce((sum, i) => sum + i.quantity, 0),
      totalAmount: () => items().reduce((sum, i) => sum + i.product.price * i.quantity, 0),
    });
    checkoutServiceSpy = jasmine.createSpyObj('CheckoutService', ['mergeItems']);

    TestBed.configureTestingModule({
      imports: [Cart],
      providers: [
        provideRouter([]),
        { provide: CartService, useValue: cartServiceSpy },
        { provide: CheckoutService, useValue: checkoutServiceSpy },
        // The template shows a guest-checkout hint, so isLoggedIn must exist.
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
      ],
    });
    router = TestBed.inject(Router);
  });

  function create() {
    const fixture = TestBed.createComponent(Cart);
    fixture.detectChanges();
    return fixture;
  }

  it('should create and select all items by default', () => {
    const fixture = create();
    expect(fixture.componentInstance.selectedCount()).toBe(2);
    expect(fixture.componentInstance.allSelected()).toBeTrue();
  });

  it('isSelected reflects the selection set', () => {
    const fixture = create();
    expect(fixture.componentInstance.isSelected('p1')).toBeTrue();
    expect(fixture.componentInstance.isSelected('missing')).toBeFalse();
  });

  it('toggleSelection adds/removes an id based on checkbox state', () => {
    const fixture = create();
    const uncheckEvent = { target: { checked: false } } as unknown as Event;
    fixture.componentInstance.toggleSelection('p1', uncheckEvent);
    expect(fixture.componentInstance.isSelected('p1')).toBeFalse();
    expect(fixture.componentInstance.selectedCount()).toBe(1);

    const checkEvent = { target: { checked: true } } as unknown as Event;
    fixture.componentInstance.toggleSelection('p1', checkEvent);
    expect(fixture.componentInstance.isSelected('p1')).toBeTrue();
  });

  it('toggleAll selects or clears all items', () => {
    const fixture = create();
    fixture.componentInstance.toggleAll({ target: { checked: false } } as unknown as Event);
    expect(fixture.componentInstance.selectedCount()).toBe(0);
    expect(fixture.componentInstance.allSelected()).toBeFalse();

    fixture.componentInstance.toggleAll({ target: { checked: true } } as unknown as Event);
    expect(fixture.componentInstance.selectedCount()).toBe(2);
  });

  it('selectedTotal sums price*quantity for selected items only', () => {
    const fixture = create();
    fixture.componentInstance.toggleSelection('p2', { target: { checked: false } } as unknown as Event);
    // Only p1 selected: 100 * 2 = 200
    expect(fixture.componentInstance.selectedTotal()).toBe(200);
  });

  it('increaseQty / decreaseQty call cartService.updateQuantity', () => {
    const fixture = create();
    fixture.componentInstance.increaseQty('p1', 2);
    expect(cartServiceSpy.updateQuantity).toHaveBeenCalledWith('p1', 3);

    fixture.componentInstance.decreaseQty('p1', 2);
    expect(cartServiceSpy.updateQuantity).toHaveBeenCalledWith('p1', 1);
  });

  it('removeItem removes from cart service and clears the selection', () => {
    const fixture = create();
    fixture.componentInstance.removeItem('p1');
    expect(cartServiceSpy.removeFromCart).toHaveBeenCalledWith('p1');
    expect(fixture.componentInstance.isSelected('p1')).toBeFalse();
  });

  it('proceedToCheckout is a no-op when nothing is selected', () => {
    const fixture = create();
    spyOn(router, 'navigate');
    fixture.componentInstance.toggleAll({ target: { checked: false } } as unknown as Event);

    fixture.componentInstance.proceedToCheckout();

    expect(checkoutServiceSpy.mergeItems).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('proceedToCheckout merges selected items into checkout and navigates', () => {
    const fixture = create();
    spyOn(router, 'navigate');

    fixture.componentInstance.proceedToCheckout();

    expect(checkoutServiceSpy.mergeItems).toHaveBeenCalledWith([
      { product, quantity: 2 },
      { product: product2, quantity: 1 },
    ]);
    expect(router.navigate).toHaveBeenCalledWith(['/checkout']);
  });
  // ---------- the advertised price is the one charged ----------

  it('bills a discounted product at its discounted price, which is what the storefront shows', () => {
    // The badge says "25% OFF" and the sale price is shown struck against ₹200. Charging the
    // full ₹200 anyway is what this guards against.
    const onOffer: Product = { ...product, price: 200, discount: 25 };

    expect(effectivePrice(onOffer)).toBe(150);
  });

  it('leaves an undiscounted product at its list price', () => {
    expect(effectivePrice(product)).toBe(100);
  });

  it('totals the cart at what the customer will actually be charged', () => {
    const onOffer: Product = { ...product, price: 200, discount: 25 };
    const lines: CartItem[] = [
      { product: onOffer, quantity: 2 },
      { product: product2, quantity: 1 },
    ];

    const total = lines.reduce((sum, i) => sum + effectivePrice(i.product) * i.quantity, 0);

    expect(total).toBe(350); // 2 x 150 + 50, not 2 x 200 + 50
  });

  // The quantity picker is our own sheet rather than a native <select>, so the wiring around it
  // is worth pinning down: the sheet has to follow the line it was opened for, and choosing has
  // to both update the cart and put the sheet away.
  describe('the quantity sheet', () => {
    it('opens against the line it was asked for', () => {
      const fixture = create();
      fixture.componentInstance.openQuantitySheet('p1');

      expect(fixture.componentInstance.quantitySheetItem()?.product.id).toBe('p1');
    });

    it('is closed to begin with, and closes again on demand', () => {
      const fixture = create();
      expect(fixture.componentInstance.quantitySheetItem()).toBeNull();

      fixture.componentInstance.openQuantitySheet('p1');
      fixture.componentInstance.closeQuantitySheet();

      expect(fixture.componentInstance.quantitySheetItem()).toBeNull();
    });

    it('applies the chosen quantity and dismisses itself', () => {
      const fixture = create();
      fixture.componentInstance.openQuantitySheet('p1');
      fixture.componentInstance.setQuantity('p1', 5);

      expect(cartServiceSpy.updateQuantity).toHaveBeenCalledWith('p1', 5);
      expect(fixture.componentInstance.quantitySheetItem()).toBeNull();
    });

    it('resolves to nothing if that line leaves the cart while the sheet is open', () => {
      // Keyed by product id rather than by index on purpose: removing another line must never
      // leave the sheet pointing at a different product than the one it was opened for.
      const fixture = create();
      fixture.componentInstance.openQuantitySheet('p1');
      items.set(items().filter((i) => i.product.id !== 'p1'));

      expect(fixture.componentInstance.quantitySheetItem()).toBeNull();
    });
  });

});
