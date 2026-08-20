import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DeliveryChargeCalculation, SavedAddress } from '../models/interfaces';
import { AuthService } from './auth.service';
import { DeliveryChargesService } from './delivery-charges.service';
import { UserService } from './user.service';

const GUEST_KEY = 'ojas_delivery_address_guest';

/**
 * The one delivery address the customer is currently shopping against, shared by
 * the post-login prompt, the product page, and checkout — so the delivery charge
 * shown on a product is the same one they pay at the end.
 */
@Injectable({ providedIn: 'root' })
export class DeliveryAddressService {
  private readonly auth = inject(AuthService);
  private readonly deliveryCharges = inject(DeliveryChargesService);
  private readonly users = inject(UserService);

  private readonly _selected = signal<SavedAddress | null>(null);
  private readonly _quote = signal<DeliveryChargeCalculation | null>(null);
  private readonly _quoteLoading = signal(false);
  /** Set once the customer has answered (or dismissed) the post-login prompt. */
  private readonly _prompted = signal(false);
  private readonly _pickerOpen = signal(false);

  readonly selected = this._selected.asReadonly();
  readonly quote = this._quote.asReadonly();
  readonly quoteLoading = this._quoteLoading.asReadonly();
  readonly prompted = this._prompted.asReadonly();
  readonly pickerOpen = this._pickerOpen.asReadonly();

  readonly hasAddress = computed(() => !!this._selected());
  readonly outOfServiceArea = computed(() => this._quote()?.isServiceable === false);

  constructor() {
    // Follow the signed-in user; a guest keeps their own pick so the delivery
    // estimate survives until they log in at checkout.
    effect(() => {
      const userId = this.auth.user()?.id ?? null;

      if (!userId) {
        const stored = this.read(GUEST_KEY);
        this._selected.set(stored);
        this._prompted.set(this.readPrompted(null));
        if (stored) this.refreshQuote(stored);
        else this._quote.set(null);
        return;
      }

      const ownAddress = this.read(this.keyFor(userId));
      if (ownAddress) {
        this._selected.set(ownAddress);
        this._prompted.set(this.readPrompted(userId));
        this.refreshQuote(ownAddress);
        return;
      }

      // No address of their own yet — a guest who just created an account at
      // checkout must not lose the address they were already shopping against.
      const guestAddress = this.read(GUEST_KEY);
      if (guestAddress) {
        this._selected.set(guestAddress);
        this._prompted.set(true);
        localStorage.setItem(this.keyFor(userId), JSON.stringify(guestAddress));
        localStorage.removeItem(GUEST_KEY);
        this.refreshQuote(guestAddress);
        // Best-effort: carry it into their saved addresses too, so it's there
        // on the profile page and future orders, not just this session.
        this.users
          .saveAddress({
            label: guestAddress.label,
            phone: guestAddress.phone,
            fullAddress: guestAddress.fullAddress,
            latitude: guestAddress.latitude,
            longitude: guestAddress.longitude,
            isDefault: true,
          })
          .subscribe({ error: () => {} });
      } else {
        this._selected.set(null);
        this._prompted.set(this.readPrompted(userId));
        this._quote.set(null);
      }
    });
  }

  openPicker(): void {
    this._pickerOpen.set(true);
  }

  closePicker(): void {
    this._pickerOpen.set(false);
    // Dismissing counts as answering — we don't nag on every navigation.
    this.markPrompted();
  }

  select(address: SavedAddress): void {
    this._selected.set(address);
    this.persist();
    this.markPrompted();
    this.refreshQuote(address);
  }

  clear(): void {
    this._selected.set(null);
    this._quote.set(null);
    localStorage.removeItem(this.keyFor(this.auth.user()?.id ?? null));
  }

  /** Records that we've asked, so the prompt doesn't reappear every navigation. */
  markPrompted(): void {
    this._prompted.set(true);
    localStorage.setItem(this.promptKeyFor(this.auth.user()?.id ?? null), '1');
  }

  private refreshQuote(address: SavedAddress): void {
    this._quoteLoading.set(true);
    this.deliveryCharges.previewCharge(address.latitude, address.longitude).subscribe({
      next: (quote) => {
        this._quote.set(quote);
        this._quoteLoading.set(false);
      },
      error: () => {
        this._quote.set(null);
        this._quoteLoading.set(false);
      },
    });
  }

  private persist(): void {
    const key = this.keyFor(this.auth.user()?.id ?? null);
    localStorage.setItem(key, JSON.stringify(this._selected()));
  }

  private keyFor(userId: string | null): string {
    return userId ? `ojas_delivery_address_${userId}` : GUEST_KEY;
  }

  private promptKeyFor(userId: string | null): string {
    return userId ? `ojas_address_prompted_${userId}` : 'ojas_address_prompted_guest';
  }

  private readPrompted(userId: string | null): boolean {
    return !!localStorage.getItem(this.promptKeyFor(userId));
  }

  private read(key: string): SavedAddress | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as SavedAddress) : null;
    } catch {
      return null;
    }
  }
}
