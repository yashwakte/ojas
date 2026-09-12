import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { WalletService } from '../../services/wallet.service';
import { ChatbotUiService } from '../../services/chatbot-ui.service';
import { SearchUiService } from '../../services/search-ui.service';
import { LogoutConfirmService } from '../../services/logout-confirm.service';
import { ScrollLockService } from '../../services/scroll-lock.service';
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from '../../constants/business';

/**
 * The phone menu behind the hamburger.
 *
 * It used to be a list that dropped down under the header, where some rows had an icon and some
 * did not, so the labels started at two different places, and nothing separated shopping from
 * account from help. It is now a panel that slides in from the right, the side the hamburger is
 * on, with labelled sections, a rule between each, one icon column for every row, and counts or
 * balances as pills against the right edge.
 *
 * Always in the page and toggled with a class, rather than added and removed, so it can animate
 * out as well as in. While closed it is `inert` and hidden, so it cannot be tabbed into or read
 * out.
 */
@Component({
  selector: 'app-mobile-drawer',
  imports: [CurrencyPipe, RouterLink, RouterLinkActive, MatIconModule, CdkTrapFocus],
  templateUrl: './mobile-drawer.html',
  styleUrl: './mobile-drawer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.open]': 'open()',
    '[attr.inert]': 'open() ? null : ""',
    '[attr.aria-hidden]': 'open() ? null : "true"',
  },
})
export class MobileDrawer {
  readonly open = input(false);
  readonly closed = output<void>();
  /** Shop by Category opens the category sheet, which the header owns. */
  readonly browseCategories = output<void>();

  readonly auth = inject(AuthService);
  readonly cart = inject(CartService);
  readonly wallet = inject(WalletService);
  private readonly chatbotUi = inject(ChatbotUiService);
  private readonly search = inject(SearchUiService);
  private readonly logoutConfirm = inject(LogoutConfirmService);
  private readonly scrollLock = inject(ScrollLockService);
  private readonly injector = inject(Injector);

  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  readonly supportPhone = SUPPORT_PHONE;
  readonly supportPhoneHref = SUPPORT_PHONE_HREF;

  private release: (() => void) | null = null;
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const open = this.open();
      untracked(() => (open ? this.onOpen() : this.onClose()));
    });
  }

  private onOpen(): void {
    this.returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.release ??= this.scrollLock.lock();
    afterNextRender(() => this.closeButton()?.nativeElement.focus(), { injector: this.injector });
  }

  private onClose(): void {
    this.release?.();
    this.release = null;
    const back = this.returnFocusTo;
    this.returnFocusTo = null;
    // Only hand focus back if it is still somewhere inside the drawer - if a row already moved it
    // on (the search box, a dialog), taking it back would undo that.
    if (back?.isConnected && document.activeElement?.closest('app-mobile-drawer')) back.focus();
  }

  isCustomerArea(): boolean {
    return !this.auth.isLoggedIn() || this.auth.role() === 'customer';
  }

  isCustomer(): boolean {
    return this.auth.isLoggedIn() && this.auth.role() === 'customer';
  }

  initials(): string {
    return (this.auth.user()?.fullName ?? '')
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  close(): void {
    this.closed.emit();
  }

  showCategories(): void {
    this.browseCategories.emit();
  }

  openSearch(): void {
    this.closed.emit();
    this.search.open();
  }

  openChat(): void {
    this.closed.emit();
    this.chatbotUi.openChat();
  }

  logout(): void {
    this.closed.emit();
    this.logoutConfirm.request();
  }
}
