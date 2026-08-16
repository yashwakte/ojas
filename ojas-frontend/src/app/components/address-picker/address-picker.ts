import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { DeliveryAddressService } from '../../services/delivery-address.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { UserService } from '../../services/user.service';
import { SavedAddress } from '../../models/interfaces';
import { MapPicker } from '../map-picker/map-picker';
import {
  DEFAULT_CITY,
  DEFAULT_STATE,
  SERVICEABLE_STATES,
  citiesForState,
  isValidPunePincode,
} from '../../constants/serviceable-locations';

/**
 * The single "where should we deliver?" surface — used both for the post-login
 * prompt and the "Deliver to" control on a product page, so the two can never
 * disagree about what the customer picked.
 */
@Component({
  selector: 'app-address-picker',
  imports: [FormsModule, MatIconModule, MapPicker],
  templateUrl: './address-picker.html',
  styleUrl: './address-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddressPicker {
  private readonly auth = inject(AuthService);
  private readonly users = inject(UserService);
  private readonly deliveryCharges = inject(DeliveryChargesService);
  protected readonly addresses = inject(DeliveryAddressService);

  protected readonly saved = signal<SavedAddress[]>([]);
  protected readonly loadingSaved = signal(false);
  protected readonly addingNew = signal(false);
  protected readonly pinned = signal<{ lat: number; lng: number } | null>(null);
  protected readonly saveError = signal('');

  protected readonly serviceableStates = SERVICEABLE_STATES;
  protected label = 'Home';
  protected houseNo = '';
  protected area = '';
  protected city = DEFAULT_CITY;
  protected state = DEFAULT_STATE;
  protected pincode = '';

  protected readonly open = this.addresses.pickerOpen;

  protected readonly cities = computed(() => citiesForState(this.state));

  protected readonly canSaveNew = computed(
    () =>
      !!this.pinned() &&
      this.houseNo.trim().length > 0 &&
      this.area.trim().length > 0 &&
      isValidPunePincode(this.pincode.trim()),
  );

  constructor() {
    effect(() => {
      if (this.open() && this.auth.isLoggedIn()) {
        this.loadSaved();
      }
    });
  }

  protected onStateChange(): void {
    const cities = citiesForState(this.state);
    if (!cities.includes(this.city)) {
      this.city = cities[0] ?? '';
    }
  }

  protected choose(address: SavedAddress): void {
    this.addresses.select(address);
    this.addresses.closePicker();
  }

  protected startAddingNew(): void {
    this.addingNew.set(true);
    this.saveError.set('');
  }

  protected onPinned(location: { lat: number; lng: number; address?: string }): void {
    this.pinned.set({ lat: location.lat, lng: location.lng });

    // Reverse-geocoded label saves re-typing the locality; house number is the
    // one thing a map can never know, so that stays theirs to fill in.
    if (location.address && !this.area.trim()) {
      this.area = location.address;
    }
    const pin = location.address?.match(/\b(\d{6})\b/)?.[1];
    if (pin && !this.pincode.trim()) {
      this.pincode = pin;
    }
  }

  protected saveNew(): void {
    const pin = this.pinned();
    if (!pin || !this.canSaveNew()) return;

    const fullAddress = [
      this.houseNo.trim(),
      this.area.trim(),
      this.city,
      `${this.state} - ${this.pincode.trim()}`,
    ]
      .filter(Boolean)
      .join(', ');

    const address: SavedAddress = {
      label: this.label.trim() || 'Home',
      fullAddress,
      latitude: pin.lat,
      longitude: pin.lng,
      isDefault: this.saved().length === 0,
    };

    // Confirm serviceability before committing, so a rejected address never
    // becomes the one we quote delivery against.
    this.deliveryCharges.previewCharge(pin.lat, pin.lng).subscribe({
      next: (quote) => {
        if (!quote.isServiceable) {
          this.saveError.set(
            `That address is about ${quote.distanceKm.toFixed(1)} km away and we deliver within ${quote.maxRadiusKm} km.`,
          );
          return;
        }
        this.commit(address);
      },
      error: () => this.commit(address),
    });
  }

  protected close(): void {
    this.addresses.closePicker();
    this.resetForm();
  }

  private commit(address: SavedAddress): void {
    // Persist to the account when signed in; guests keep it locally until checkout.
    if (this.auth.isLoggedIn()) {
      this.users
        .saveAddress({
          label: address.label,
          fullAddress: address.fullAddress,
          latitude: address.latitude,
          longitude: address.longitude,
          isDefault: address.isDefault,
        })
        .subscribe({ error: () => {} });
    }
    this.addresses.select(address);
    this.addresses.closePicker();
    this.resetForm();
  }

  private resetForm(): void {
    this.addingNew.set(false);
    this.pinned.set(null);
    this.saveError.set('');
    this.houseNo = '';
    this.area = '';
    this.pincode = '';
    this.label = 'Home';
  }

  private loadSaved(): void {
    this.loadingSaved.set(true);
    this.users.getProfile().subscribe({
      next: (profile) => {
        this.saved.set(profile.savedAddresses ?? []);
        this.loadingSaved.set(false);
        // Nothing to choose from — go straight to pinning a new one.
        if (!this.saved().length) this.addingNew.set(true);
      },
      error: () => {
        this.saved.set([]);
        this.loadingSaved.set(false);
        this.addingNew.set(true);
      },
    });
  }
}
