import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { Header } from './header';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { ProductService } from '../../services/product.service';
import { SearchUiService } from '../../services/search-ui.service';
import { LogoutConfirmService } from '../../services/logout-confirm.service';
import { PRODUCT_CATEGORIES, ProductCategory } from '../../constants/product-categories';

describe('Header', () => {
  let cartItems: ReturnType<typeof signal<any[]>>;
  let checkoutCount: ReturnType<typeof signal<number>>;
  let authUser: ReturnType<typeof signal<any>>;
  let categoriesInUse: ReturnType<typeof signal<readonly ProductCategory[]>>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    cartItems = signal<any[]>([]);
    checkoutCount = signal(0);
    authUser = signal<any>(null);
    categoriesInUse = signal<readonly ProductCategory[]>(PRODUCT_CATEGORIES);

    authServiceSpy = jasmine.createSpyObj('AuthService', ['getDefaultRouteForRole'], {
      user: authUser,
      isLoggedIn: () => !!authUser(),
      role: () => authUser()?.role ?? 'customer',
      isAdmin: () => authUser()?.role === 'admin',
      isDelivery: () => authUser()?.role === 'delivery',
    });
    authServiceSpy.getDefaultRouteForRole.and.returnValue('/');

    TestBed.configureTestingModule({
      imports: [Header],
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceSpy },
        { provide: CartService, useValue: { items: cartItems } },
        { provide: CheckoutService, useValue: { count: checkoutCount } },
        { provide: ProductService, useValue: { categoriesInUse: categoriesInUse.asReadonly() } },
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

  it('toggleMenu flips menuOpen', () => {
    const header = create().componentInstance;

    header.toggleMenu();
    expect(header.menuOpen()).toBeTrue();

    header.toggleMenu();
    expect(header.menuOpen()).toBeFalse();
  });

  it('toggleMenu closes the categories sheet when opening', () => {
    const header = create().componentInstance;
    header.categoriesSheetOpen.set(true);

    header.toggleMenu();

    expect(header.menuOpen()).toBeTrue();
    expect(header.categoriesSheetOpen()).toBeFalse();
  });

  it('toggleCategoriesSheet flips the signal and closes the hamburger menu when opening', () => {
    const header = create().componentInstance;
    header.menuOpen.set(true);

    header.toggleCategoriesSheet();
    expect(header.categoriesSheetOpen()).toBeTrue();
    expect(header.menuOpen()).toBeFalse();

    header.toggleCategoriesSheet();
    expect(header.categoriesSheetOpen()).toBeFalse();
  });

  it('openCategoriesFromMenu always opens the sheet and closes the drawer', () => {
    const header = create().componentInstance;
    header.menuOpen.set(true);

    header.openCategoriesFromMenu();

    expect(header.menuOpen()).toBeFalse();
    expect(header.categoriesSheetOpen()).toBeTrue();
  });

  it('openSearch closes the drawer and opens the search overlay', () => {
    const header = create().componentInstance;
    const search = TestBed.inject(SearchUiService);
    header.menuOpen.set(true);

    header.openSearch();

    expect(header.menuOpen()).toBeFalse();
    expect(search.isOpen()).toBeTrue();
  });

  it('logout asks for confirmation instead of signing out on the tap', () => {
    const header = create().componentInstance;
    const confirm = TestBed.inject(LogoutConfirmService);
    spyOn(confirm, 'request');
    header.menuOpen.set(true);

    header.logout();

    expect(confirm.request).toHaveBeenCalled();
    expect(header.menuOpen()).toBeFalse();
  });

  it('"/" opens search from anywhere but a text field, and not for staff', () => {
    const header = create().componentInstance;
    const search = TestBed.inject(SearchUiService);
    const slash = (target?: EventTarget) => {
      const event = new KeyboardEvent('keydown', { key: '/', cancelable: true });
      if (target) Object.defineProperty(event, 'target', { value: target });
      return event;
    };

    header.onDocumentKeydown(slash());
    expect(search.isOpen()).toBeTrue();
    search.close();

    header.onDocumentKeydown(slash(document.createElement('input')));
    expect(search.isOpen()).toBeFalse();

    authUser.set({ role: 'admin' });
    header.onDocumentKeydown(slash());
    expect(search.isOpen()).toBeFalse();
  });

  it('Escape closes the drawer and the category sheet', () => {
    const header = create().componentInstance;
    header.menuOpen.set(true);
    header.onEscape();
    expect(header.menuOpen()).toBeFalse();

    header.categoriesSheetOpen.set(true);
    header.onEscape();
    expect(header.categoriesSheetOpen()).toBeFalse();
  });

  it('hands the drawer its open state once the drawer has loaded', async () => {
    const fixture = create();
    const [drawerBlock] = await fixture.getDeferBlocks();
    await drawerBlock.render(DeferBlockState.Complete);
    const drawer: HTMLElement = fixture.nativeElement.querySelector('app-mobile-drawer');
    expect(drawer.classList).not.toContain('open');

    fixture.componentInstance.menuOpen.set(true);
    fixture.detectChanges();

    expect(drawer.classList).toContain('open');
  });

  it('lists only the categories that have products in the desktop menu', () => {
    categoriesInUse.set(['Everyday Flours', 'Upwas']);
    const fixture = create();

    const links = fixture.nativeElement.querySelectorAll('.nav-dropdown-panel a');
    expect(Array.from(links).map((a) => (a as HTMLElement).textContent?.trim())).toEqual([
      'grainEveryday Flours',
      'self_improvementUpwas',
    ]);
  });

  it('openDesktopCategoryMenu / closeDesktopCategoryMenu set the signal', () => {
    const header = create().componentInstance;
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
    expect(create().componentInstance.getInitials()).toBe('');
  });

  it('getInitials builds initials from the full name, capped at 2 chars', () => {
    const fixture = create();
    authUser.set({ fullName: 'Jane Marie Doe' });
    expect(fixture.componentInstance.getInitials()).toBe('JM');
  });

  it('isCustomerArea is true when logged out', () => {
    expect(create().componentInstance.isCustomerArea()).toBeTrue();
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
    const header = create().componentInstance;
    header.desktopCategoryOpen.set(true);

    const container = document.createElement('div');
    const outside = document.createElement('button');
    const event = { currentTarget: container, relatedTarget: outside } as unknown as FocusEvent;

    header.onDesktopCategoryFocusOut(event);

    expect(header.desktopCategoryOpen()).toBeFalse();
  });

  it('onDesktopCategoryFocusOut keeps the menu open when focus stays inside the container', () => {
    const header = create().componentInstance;
    header.desktopCategoryOpen.set(true);

    const container = document.createElement('div');
    const inner = document.createElement('button');
    container.appendChild(inner);
    const event = { currentTarget: container, relatedTarget: inner } as unknown as FocusEvent;

    header.onDesktopCategoryFocusOut(event);

    expect(header.desktopCategoryOpen()).toBeTrue();
  });
});
