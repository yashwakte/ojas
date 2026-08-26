import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { ProductDetail } from './product-detail';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { AuthService } from '../../services/auth.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import {
  Product,
  DeliveryChargesConfig,
  deliveryDaysLabel,
  deliveryPromiseByDate,
  deliveryPromiseLabel,
  deliveryWindow,
} from '../../models/interfaces';

describe('ProductDetail', () => {
  const product: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'desc',
    price: 100,
    discount: 10,
    category: 'Flour',
    imageUrl: '/images/p1.jpg',
    galleryImageUrls: ['/images/p1b.jpg'],
    weight: '500g',
    isAvailable: true,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: 'Bajra',
    benefits: 'Fiber',
    storageInfo: 'Cool place',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
  const similarProduct: Product = { ...product, id: 'p2', name: 'Jowar Flour' };

  let productServiceSpy: jasmine.SpyObj<ProductService>;
  let cartServiceSpy: jasmine.SpyObj<CartService>;
  let checkoutServiceSpy: jasmine.SpyObj<CheckoutService>;
  let authServiceSpy: any;
  let deliveryChargesServiceSpy: any;
  let router: Router;

  beforeEach(() => {
    productServiceSpy = jasmine.createSpyObj('ProductService', ['getProduct', 'getByCategory']);
    productServiceSpy.getProduct.and.returnValue(product);
    productServiceSpy.getByCategory.and.returnValue([product, similarProduct]);

    cartServiceSpy = jasmine.createSpyObj('CartService', ['addToCart']);
    checkoutServiceSpy = jasmine.createSpyObj('CheckoutService', ['addItem']);
    authServiceSpy = jasmine.createSpyObj('AuthService', ['isLoggedIn', 'user']);
    authServiceSpy.isLoggedIn.and.returnValue(true);
    // DeliveryAddressService (injected for the "Deliver to" bar) reads user().
    authServiceSpy.user.and.returnValue(null);
    deliveryChargesServiceSpy = { config: signal<DeliveryChargesConfig | null>(null) };

    TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [
        provideRouter([]),
        { provide: ProductService, useValue: productServiceSpy },
        { provide: CartService, useValue: cartServiceSpy },
        { provide: CheckoutService, useValue: checkoutServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: DeliveryChargesService, useValue: deliveryChargesServiceSpy },
      ],
    });
    router = TestBed.inject(Router);
  });

  function create(id = 'p1') {
    const fixture = TestBed.createComponent(ProductDetail);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return fixture;
  }

  it('should create and resolve the product from the id input', () => {
    const fixture = create();
    expect(fixture.componentInstance.product()).toEqual(product);
  });

  it('discountedPrice applies the discount percentage', () => {
    const fixture = create();
    expect(fixture.componentInstance.discountedPrice()).toBe(90);
  });

  it('discountedPrice equals price when there is no discount', () => {
    productServiceSpy.getProduct.and.returnValue({ ...product, discount: 0 });
    const fixture = create();
    expect(fixture.componentInstance.discountedPrice()).toBe(100);
  });

  it('discountedPrice is 0 when the product is not found', () => {
    productServiceSpy.getProduct.and.returnValue(undefined);
    const fixture = create('missing');
    expect(fixture.componentInstance.discountedPrice()).toBe(0);
  });

  it('galleryImages combines the main image with gallery images', () => {
    const fixture = create();
    expect(fixture.componentInstance.galleryImages()).toEqual(['/images/p1.jpg', '/images/p1b.jpg']);
  });

  it('similarProducts excludes the current product and reads from getByCategory', () => {
    const fixture = create();
    expect(fixture.componentInstance.similarProducts()).toEqual([similarProduct]);
    expect(productServiceSpy.getByCategory).toHaveBeenCalledWith('Flour');
  });

  it('selectImage sets the active image index', () => {
    const fixture = create();
    fixture.componentInstance.selectImage(1);
    expect(fixture.componentInstance.activeImageIndex()).toBe(1);
  });

  it('toggleSection expands and collapses a section', () => {
    const fixture = create();
    expect(fixture.componentInstance.isSectionExpanded('ingredients')).toBeFalse();
    fixture.componentInstance.toggleSection('ingredients');
    expect(fixture.componentInstance.isSectionExpanded('ingredients')).toBeTrue();
    fixture.componentInstance.toggleSection('ingredients');
    expect(fixture.componentInstance.isSectionExpanded('ingredients')).toBeFalse();
  });

  it('increaseQty / decreaseQty adjust quantity, never going below 1', () => {
    const fixture = create();
    fixture.componentInstance.increaseQty();
    expect(fixture.componentInstance.quantity()).toBe(2);
    fixture.componentInstance.decreaseQty();
    fixture.componentInstance.decreaseQty();
    expect(fixture.componentInstance.quantity()).toBe(1);
  });

  it('toggleDescription flips descExpanded', () => {
    const fixture = create();
    expect(fixture.componentInstance.descExpanded()).toBeFalse();
    fixture.componentInstance.toggleDescription();
    expect(fixture.componentInstance.descExpanded()).toBeTrue();
  });

  it('addToCart works when logged out so guests can build a cart', () => {
    authServiceSpy.isLoggedIn.and.returnValue(false);
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.addToCart();

    expect(cartServiceSpy.addToCart).toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('addToCart adds the product to the cart quantity() times', () => {
    const fixture = create();
    fixture.componentInstance.increaseQty(); // quantity = 2

    fixture.componentInstance.addToCart();

    expect(cartServiceSpy.addToCart).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.justAdded()).toBe('p1');
  });

  it('addToCart is a no-op when there is no product', () => {
    productServiceSpy.getProduct.and.returnValue(undefined);
    const fixture = create('missing');

    fixture.componentInstance.addToCart();

    expect(cartServiceSpy.addToCart).not.toHaveBeenCalled();
  });

  it('buyNow sends a logged-out guest to checkout, where the auth guard takes over', () => {
    authServiceSpy.isLoggedIn.and.returnValue(false);
    spyOn(router, 'navigate');
    const fixture = create();

    fixture.componentInstance.buyNow();

    expect(checkoutServiceSpy.addItem).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/checkout']);
  });

  it('buyNow adds to checkout with the selected quantity and navigates', () => {
    spyOn(router, 'navigate');
    const fixture = create();
    fixture.componentInstance.increaseQty(); // quantity = 2

    fixture.componentInstance.buyNow();

    expect(checkoutServiceSpy.addItem).toHaveBeenCalledWith(product, 2);
    expect(router.navigate).toHaveBeenCalledWith(['/checkout']);
  });

  it('freeDeliveryUpToKm reads from delivery charges config', () => {
    deliveryChargesServiceSpy.config.set({
      id: 'c1',
      warehouseAddress: 'x',
      warehouseLatitude: 1,
      warehouseLongitude: 1,
      freeDeliveryUpToKm: 7,
      perKmChargeAfterFree: 10,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    });
    const fixture = create();
    expect(fixture.componentInstance.freeDeliveryUpToKm()).toBe(7);
  });

  it('highlights include category-specific entries for Flour', () => {
    const fixture = create();
    const texts = fixture.componentInstance.highlights().map((h) => h.text);
    expect(texts).toContain('Traditional Stone-Ground');
  });

  it('onImgError swaps the broken image to the placeholder', () => {
    const fixture = create();
    const img = document.createElement('img');
    fixture.componentInstance.onImgError({ target: img } as unknown as Event);
    expect(img.src).toContain('/images/placeholder.svg');
  });
  // ---------- the delivery promise ----------

  it('promises delivery in 1-2 days, with a date the customer can hold us to', () => {
    const fixture = create();

    const rendered = fixture.nativeElement.textContent as string;
    expect(deliveryPromiseLabel()).toBe('Arriving in 1–2 days');
    expect(rendered).toContain('Arriving in 1–2 days');
    // Vague on its own, so the outer edge of the window is named as a real date too.
    expect(rendered).toContain(deliveryPromiseByDate());
  });

  it('shows the promise whether or not a delivery address has been picked', () => {
    // The charge depends on the address; the timing does not, so it must not hide with it.
    const fixture = create();

    expect(fixture.componentInstance.deliveryPromise()).toBe(deliveryPromiseLabel());
  });

  it('states the same window on the spec card, rather than its own hardcoded figure', () => {
    // This card sat on "3-5 business days" long after the promise had changed, because the
    // number was written into the template instead of being read from the shared window.
    const fixture = create();

    const rendered = fixture.nativeElement.textContent as string;
    expect(rendered).toContain('Estimated Delivery');
    expect(rendered).toContain(`${deliveryDaysLabel()}, by ${deliveryPromiseByDate()}`);
    expect(rendered).not.toContain('business days');
  });

  it('spans tomorrow to the day after, and rolls correctly across a year boundary', () => {
    const newYearsEve = new Date(2026, 11, 31, 22, 0, 0);

    const { from, to } = deliveryWindow(newYearsEve);

    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2027, 0, 1]);
    expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2027, 0, 2]);
  });

  // The photo strip is a real scroller: a swipe, an arrow and a thumbnail all move the same
  // scrollLeft, and the active photo is read back out of it rather than each control keeping its
  // own idea of which one is showing.
  describe('the photo gallery', () => {
    /** The strip has no layout in a test browser, so its width and a recording scrollTo are
     * supplied - the component measures against exactly these two things. */
    function pinTrack(fixture: ReturnType<typeof create>, width = 400) {
      const track: HTMLElement = fixture.nativeElement.querySelector('.gallery-track');
      Object.defineProperty(track, 'clientWidth', { value: width, configurable: true });
      const scrolls: number[] = [];
      track.scrollTo = ((options: ScrollToOptions) => {
        scrolls.push(options.left ?? 0);
        Object.defineProperty(track, 'scrollLeft', {
          value: options.left ?? 0,
          configurable: true,
        });
      }) as typeof track.scrollTo;
      return { track, scrolls };
    }

    it('shows every photo in the strip, front first', () => {
      const fixture = create();
      const slides = fixture.nativeElement.querySelectorAll('.gallery-slide img');

      expect(slides.length).toBe(2);
      expect(slides[0].getAttribute('src')).toBe('/images/p1.jpg');
      expect(slides[1].getAttribute('src')).toBe('/images/p1b.jpg');
    });

    it('follows a swipe without anyone touching a thumbnail', () => {
      const fixture = create();
      const { track } = pinTrack(fixture);

      // What the browser reports after the strip has snapped to the second photo.
      Object.defineProperty(track, 'scrollLeft', { value: 400, configurable: true });
      track.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();

      expect(fixture.componentInstance.activeImageIndex()).toBe(1);
    });

    it('rounds to the nearest photo, so a part-way drag does not flicker', () => {
      const fixture = create();
      const { track } = pinTrack(fixture);

      Object.defineProperty(track, 'scrollLeft', { value: 160, configurable: true });
      track.dispatchEvent(new Event('scroll'));

      expect(fixture.componentInstance.activeImageIndex()).toBe(0);
    });

    it('scrolls the strip when a thumbnail is chosen, rather than swapping the image out', () => {
      const fixture = create();
      const { scrolls } = pinTrack(fixture);

      fixture.componentInstance.selectImage(1);

      expect(scrolls).toEqual([400]);
      expect(fixture.componentInstance.activeImageIndex()).toBe(1);
    });

    it('opens the full-screen viewer on the photo that was tapped', () => {
      const fixture = create();
      expect(fixture.nativeElement.querySelector('app-image-lightbox')).toBeNull();

      fixture.nativeElement.querySelectorAll('.gallery-slide')[1].click();
      fixture.detectChanges();

      expect(fixture.componentInstance.lightboxIndex()).toBe(1);
      expect(fixture.nativeElement.querySelector('app-image-lightbox')).not.toBeNull();
    });

    it('opens on the first photo too — index 0 must not read as "closed"', () => {
      // lightboxIndex is a number-or-null on purpose. Anything that treats 0 as falsy here leaves
      // tapping the main photo doing nothing at all.
      const fixture = create();
      fixture.nativeElement.querySelectorAll('.gallery-slide')[0].click();
      fixture.detectChanges();

      expect(fixture.componentInstance.lightboxIndex()).toBe(0);
      expect(fixture.nativeElement.querySelector('app-image-lightbox')).not.toBeNull();
    });

    it('leaves the strip on whatever the viewer was closed at', () => {
      const fixture = create();
      const { scrolls } = pinTrack(fixture);

      fixture.componentInstance.openLightbox(0);
      fixture.componentInstance.onLightboxIndexChanged(1);
      fixture.componentInstance.closeLightbox();
      fixture.detectChanges();

      expect(fixture.componentInstance.activeImageIndex()).toBe(1);
      expect(scrolls).toEqual([400]);
      expect(fixture.nativeElement.querySelector('app-image-lightbox')).toBeNull();
    });
  });

});
