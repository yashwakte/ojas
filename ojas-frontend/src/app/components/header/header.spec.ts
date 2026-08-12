import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { Header } from './header';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';

describe('Header', () => {
  let cartItems: ReturnType<typeof signal<any[]>>;
  let checkoutCount: ReturnType<typeof signal<number>>;
  let authUser: ReturnType<typeof signal<any>>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let cartServiceSpy: any;
  let checkoutServiceSpy: any;

  beforeEach(() => {
    cartItems = signal<any[]>([]);
    checkoutCount = signal(0);
    authUser = signal<any>(null);

    authServiceSpy = jasmine.createSpyObj('AuthService', ['getDefaultRouteForRole'], {
      user: authUser,
      isLoggedIn: () => !!authUser(),
      role: () => authUser()?.role ?? 'customer',
    });
    authServiceSpy.getDefaultRouteForRole.and.returnValue('/');

    cartServiceSpy = { items: cartItems };
    checkoutServiceSpy = { count: checkoutCount };

    TestBed.configureTestingModule({
      imports: [Header],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceSpy },
        { provide: CartService, useValue: cartServiceSpy },
        { provide: CheckoutService, useValue: checkoutServiceSpy },
      ],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(Header);
    fixture.detectChanges();
    return fixture;
  }

  it('should create', () => {
    const fixture = create();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('toggleMenu flips menuOpen and closes the category menu when closing', () => {
    const fixture = create();
    const header = fixture.componentInstance;
    header.categoryMenuOpen.set(true);

    header.toggleMenu();
    expect(header.menuOpen).toBeTrue();

    header.toggleMenu();
    expect(header.menuOpen).toBeFalse();
    expect(header.categoryMenuOpen()).toBeFalse();
  });

  it('toggleCategoryMenu toggles the signal', () => {
    const fixture = create();
    const header = fixture.componentInstance;
    expect(header.categoryMenuOpen()).toBeFalse();
    header.toggleCategoryMenu();
    expect(header.categoryMenuOpen()).toBeTrue();
    header.toggleCategoryMenu();
    expect(header.categoryMenuOpen()).toBeFalse();
  });

  it('openDesktopCategoryMenu / closeDesktopCategoryMenu set the signal', () => {
    const fixture = create();
    const header = fixture.componentInstance;
    header.openDesktopCategoryMenu();
    expect(header.desktopCategoryOpen()).toBeTrue();
    header.closeDesktopCategoryMenu();
    expect(header.desktopCategoryOpen()).toBeFalse();
  });

  it('goToCheckout is a no-op when checkout count is 0', () => {
    const fixture = create();
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    checkoutCount.set(0);

    fixture.componentInstance.goToCheckout();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('goToCheckout navigates to /checkout when there are items', () => {
    const fixture = create();
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    checkoutCount.set(2);

    fixture.componentInstance.goToCheckout();

    expect(router.navigate).toHaveBeenCalledWith(['/checkout']);
  });

  it('activeCheckoutCount returns the checkout service count', () => {
    const fixture = create();
    checkoutCount.set(5);
    expect(fixture.componentInstance.activeCheckoutCount()).toBe(5);
  });

  it('getInitials returns empty string when logged out', () => {
    const fixture = create();
    expect(fixture.componentInstance.getInitials()).toBe('');
  });

  it('getInitials builds initials from the full name, capped at 2 chars', () => {
    const fixture = create();
    authUser.set({ fullName: 'Jane Marie Doe' });
    expect(fixture.componentInstance.getInitials()).toBe('JM');
  });

  it('isCustomerArea is true when logged out', () => {
    const fixture = create();
    expect(fixture.componentInstance.isCustomerArea()).toBeTrue();
  });

  it('isCustomerArea is true for a customer and false for admin/delivery', () => {
    const fixture = create();
    authUser.set({ role: 'customer' });
    expect(fixture.componentInstance.isCustomerArea()).toBeTrue();

    authUser.set({ role: 'admin' });
    expect(fixture.componentInstance.isCustomerArea()).toBeFalse();
  });

  it('homeRoute delegates to auth.getDefaultRouteForRole()', () => {
    const fixture = create();
    authServiceSpy.getDefaultRouteForRole.and.returnValue('/admin');
    expect(fixture.componentInstance.homeRoute()).toBe('/admin');
  });

  it('bounces the cart badge when the cart item count increases', (done) => {
    const fixture = create();
    const header = fixture.componentInstance;
    expect(header.cartBounce()).toBeFalse();

    cartItems.set([{ product: { id: 'p1' }, quantity: 1 }]);
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(header.cartBounce()).toBeTrue();

    setTimeout(() => {
      expect(header.cartBounce()).toBeFalse();
      done();
    }, 650);
  });

  it('onDesktopCategoryFocusOut closes the menu when focus leaves the container', () => {
    const fixture = create();
    const header = fixture.componentInstance;
    header.desktopCategoryOpen.set(true);

    const container = document.createElement('div');
    const outside = document.createElement('button');
    const event = { currentTarget: container, relatedTarget: outside } as unknown as FocusEvent;

    header.onDesktopCategoryFocusOut(event);

    expect(header.desktopCategoryOpen()).toBeFalse();
  });

  it('onDesktopCategoryFocusOut keeps the menu open when focus stays inside the container', () => {
    const fixture = create();
    const header = fixture.componentInstance;
    header.desktopCategoryOpen.set(true);

    const container = document.createElement('div');
    const inner = document.createElement('button');
    container.appendChild(inner);
    const event = { currentTarget: container, relatedTarget: inner } as unknown as FocusEvent;

    header.onDesktopCategoryFocusOut(event);

    expect(header.desktopCategoryOpen()).toBeTrue();
  });
});
