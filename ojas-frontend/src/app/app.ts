import { Component, OnInit, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { Header } from './components/header/header';
import { Footer } from './components/footer/footer';
import { SiteIntro } from './components/site-intro/site-intro';
import { WelcomeCelebration } from './components/welcome-celebration/welcome-celebration';
import { GuestWelcome } from './components/guest-welcome/guest-welcome';
import { AddressPicker } from './components/address-picker/address-picker';
import { ChatbotWidget } from './components/chatbot-widget/chatbot-widget';
import { SessionSwitchNotice } from './components/session-switch-notice/session-switch-notice';
import { AuthService } from './services/auth.service';
import { DeliveryAddressService } from './services/delivery-address.service';
import { AppRecoveryService } from './services/app-recovery.service';

/** Let the login celebration finish before asking for an address. */
const ADDRESS_PROMPT_DELAY_MS = 4200;

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    Header,
    Footer,
    SiteIntro,
    WelcomeCelebration,
    GuestWelcome,
    AddressPicker,
    ChatbotWidget,
    SessionSwitchNotice,
    MatIconModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly deliveryAddress = inject(DeliveryAddressService);
  private readonly router = inject(Router);
  readonly recovery = inject(AppRecoveryService);
  private promptTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // A route that actually rendered is the only proof the build is whole. Bootstrap resolving
    // proves nothing - it happens before the first lazy chunk is even requested - so this, not
    // bootstrap, is what clears the stale-build reload guard.
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.recovery.onNavigationSucceeded());

    // Ask a signed-in customer where they want deliveries once, and only once —
    // dismissing it counts as an answer, and they can reopen it from any product.
    effect(() => {
      const isCustomer = this.auth.isLoggedIn() && this.auth.role() === 'customer';
      const needsAddress =
        isCustomer && !this.deliveryAddress.hasAddress() && !this.deliveryAddress.prompted();

      if (!needsAddress) return;
      if (this.promptTimer) return;

      this.promptTimer = setTimeout(() => {
        this.promptTimer = null;
        // Re-check: they may have set one from a product page while we waited.
        if (!this.deliveryAddress.hasAddress() && !this.deliveryAddress.prompted()) {
          this.deliveryAddress.openPicker();
        }
      }, ADDRESS_PROMPT_DELAY_MS);
    });
  }

  ngOnInit() {
    this.auth.ping();

    // Reconcile the cached user against whoever the cookie actually belongs to. This is what
    // catches a tab that was left open while a different account signed in elsewhere in the
    // browser, and it still does the job it was originally added for: a session that expired
    // server-side is found now rather than at whatever moment the user next happens to trigger
    // an authenticated request.
    this.auth.syncSession(true);
  }
}
