import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { MobileDrawer } from './mobile-drawer';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { WalletService } from '../../services/wallet.service';
import { ChatbotUiService } from '../../services/chatbot-ui.service';
import { SearchUiService } from '../../services/search-ui.service';
import { LogoutConfirmService } from '../../services/logout-confirm.service';
import { ScrollLockService } from '../../services/scroll-lock.service';

describe('MobileDrawer', () => {
  function configure(user: { fullName?: string; role: string; phone?: string } | null) {
    const authUser = signal<any>(user);
    TestBed.configureTestingModule({
      imports: [MobileDrawer],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: AuthService,
          useValue: {
            user: authUser,
            isLoggedIn: () => !!authUser(),
            role: () => authUser()?.role ?? 'customer',
            isAdmin: () => authUser()?.role === 'admin',
            isDelivery: () => authUser()?.role === 'delivery',
          },
        },
        { provide: CartService, useValue: { items: signal([{}, {}]) } },
        { provide: WalletService, useValue: { balance: signal(125) } },
      ],
    });
  }

  function create(open = true): ComponentFixture<MobileDrawer> {
    const fixture = TestBed.createComponent(MobileDrawer);
    fixture.componentRef.setInput('open', open);
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: ComponentFixture<MobileDrawer>) => f.nativeElement as HTMLElement;
  const sections = (f: ComponentFixture<MobileDrawer>) =>
    Array.from(el(f).querySelectorAll('.drawer-label')).map((e) => e.textContent?.trim());

  it('gives a guest the shop and help sections and a way to log in, but no log out', () => {
    configure(null);
    const fixture = create();

    expect(sections(fixture)).toEqual(['Shop', 'Help & Info']);
    expect(el(fixture).querySelector('.drawer-auth')).not.toBeNull();
    expect(el(fixture).querySelector('.drawer-logout')).toBeNull();
  });

  it('gives a customer an account section with their wallet balance and cart count', () => {
    configure({ fullName: 'Asha Patil', role: 'customer', phone: '9876543210' });
    const fixture = create();

    expect(sections(fixture)).toEqual(['Shop', 'My Account', 'Help & Info']);
    expect(el(fixture).textContent).toContain('₹125.00');
    expect(el(fixture).querySelector('.drawer-pill--count')?.textContent?.trim()).toBe('2');
    expect(el(fixture).querySelector('.drawer-avatar')?.textContent?.trim()).toBe('AP');
    expect(el(fixture).querySelector('.drawer-logout')).not.toBeNull();
  });

  it('shows staff their workspace rather than the shop', () => {
    configure({ fullName: 'Admin', role: 'admin' });
    const fixture = create();

    expect(sections(fixture)).toEqual(['Workspace']);
    expect(el(fixture).textContent).toContain('Admin Panel');
    expect(el(fixture).querySelector('.drawer-logout')).not.toBeNull();
  });

  // The complaint this drawer replaced: some rows had an icon and some did not, so the labels
  // started at two different places down the menu.
  it('puts every row on the same icon column', () => {
    configure({ fullName: 'Asha Patil', role: 'customer' });
    const fixture = create();

    const rows = Array.from(el(fixture).querySelectorAll('.drawer-item'));
    expect(rows.length).toBeGreaterThan(8);
    for (const row of rows) {
      expect(row.firstElementChild?.classList).toContain('drawer-ico');
    }
  });

  it('emits closed from the close button', () => {
    configure(null);
    const fixture = create();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);

    (el(fixture).querySelector('.drawer-close') as HTMLButtonElement).click();

    expect(closed).toBe(1);
  });

  it('log out closes the drawer and asks for confirmation', () => {
    configure({ fullName: 'Asha Patil', role: 'customer' });
    const fixture = create();
    const confirm = TestBed.inject(LogoutConfirmService);
    spyOn(confirm, 'request');
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);

    (el(fixture).querySelector('.drawer-logout') as HTMLButtonElement).click();

    expect(closed).toBe(1);
    expect(confirm.request).toHaveBeenCalled();
  });

  it('search closes the drawer and opens the search overlay', () => {
    configure(null);
    const fixture = create();
    const search = TestBed.inject(SearchUiService);
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);

    fixture.componentInstance.openSearch();

    expect(closed).toBe(1);
    expect(search.isOpen()).toBeTrue();
  });

  it('chat closes the drawer and opens the support chat', () => {
    configure(null);
    const fixture = create();
    const chatbot = TestBed.inject(ChatbotUiService);
    spyOn(chatbot, 'openChat');
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);

    fixture.componentInstance.openChat();

    expect(closed).toBe(1);
    expect(chatbot.openChat).toHaveBeenCalled();
  });

  it('Shop by Category asks the header for the category sheet', () => {
    configure(null);
    const fixture = create();
    let asked = 0;
    fixture.componentInstance.browseCategories.subscribe(() => asked++);

    fixture.componentInstance.showCategories();

    expect(asked).toBe(1);
  });

  it('is inert and hidden from assistive tech while closed', () => {
    configure(null);
    const fixture = create(false);

    expect(el(fixture).hasAttribute('inert')).toBeTrue();
    expect(el(fixture).getAttribute('aria-hidden')).toBe('true');

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(el(fixture).hasAttribute('inert')).toBeFalse();
    expect(el(fixture).classList).toContain('open');
  });

  it('holds the page still while open and lets it go when closed', () => {
    configure(null);
    const release = jasmine.createSpy('release');
    spyOn(TestBed.inject(ScrollLockService), 'lock').and.returnValue(release);

    const fixture = create(true);
    expect(release).not.toHaveBeenCalled();

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();

    expect(release).toHaveBeenCalledTimes(1);
  });
});
