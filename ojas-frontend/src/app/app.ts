import { Component, OnInit, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';
import { Footer } from './components/footer/footer';
import { SiteIntro } from './components/site-intro/site-intro';
import { WelcomeCelebration } from './components/welcome-celebration/welcome-celebration';
import { GuestWelcome } from './components/guest-welcome/guest-welcome';
import { AddressPicker } from './components/address-picker/address-picker';
import { AuthService } from './services/auth.service';
import { DeliveryAddressService } from './services/delivery-address.service';

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
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly deliveryAddress = inject(DeliveryAddressService);
  private promptTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
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

    if (this.auth.isLoggedIn()) {
      this.auth.validateSession().subscribe({ error: () => {} });
    }
  }
}
