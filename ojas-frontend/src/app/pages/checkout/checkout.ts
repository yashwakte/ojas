import { ChangeDetectionStrategy, Component, OnInit, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { OrderService } from '../../services/order.service';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { PlaceOrderRequest, SaveAddressRequest, SavedAddress } from '../../models/interfaces';
import { MapPicker } from '../../components/map-picker/map-picker';

@Component({
  selector: 'app-checkout',
  imports: [RouterLink, FormsModule, MatIconModule, MapPicker],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Checkout implements OnInit {
  fullName = '';
  phone = '';
  notes = '';

  // Structured address fields (used when no saved address is selected)
  houseNo = '';
  street = '';
  area = '';
  landmark = '';
  city = '';
  state = '';
  pincode = '';
  manualLat: number | null = null;
  manualLng: number | null = null;
  showManualMapPicker = signal(false);

  // Save new address
  saveNewAddress = false;
  saveNewAddressLabel = '';

  readonly indianStates = [
    'Andhra Pradesh',
    'Arunachal Pradesh',
    'Assam',
    'Bihar',
    'Chhattisgarh',
    'Goa',
    'Gujarat',
    'Haryana',
    'Himachal Pradesh',
    'Jharkhand',
    'Karnataka',
    'Kerala',
    'Madhya Pradesh',
    'Maharashtra',
    'Manipur',
    'Meghalaya',
    'Mizoram',
    'Nagaland',
    'Odisha',
    'Punjab',
    'Rajasthan',
    'Sikkim',
    'Tamil Nadu',
    'Telangana',
    'Tripura',
    'Uttar Pradesh',
    'Uttarakhand',
    'West Bengal',
    'Andaman and Nicobar Islands',
    'Chandigarh',
    'Dadra and Nagar Haveli and Daman and Diu',
    'Delhi',
    'Jammu and Kashmir',
    'Ladakh',
    'Lakshadweep',
    'Puducherry',
  ];

  loading = signal(false);
  orderPlaced = signal(false);
  orderId = signal('');
  errorMsg = signal('');
  savedAddresses = signal<SavedAddress[]>([]);
  selectedSavedAddress = signal<SavedAddress | null>(null);

  readonly totalAmount = computed(() =>
    this.checkoutService.items().reduce((sum, i) => sum + i.product.price * i.quantity, 0),
  );

  constructor(
    private cartService: CartService,
    public checkoutService: CheckoutService,
    private orderService: OrderService,
    public auth: AuthService,
    private userService: UserService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const user = this.auth.user();

    // Pre-fill from logged-in user
    this.fullName = user?.fullName ?? '';

    // Load saved addresses and pre-select default
    this.userService.getProfile().subscribe({
      next: (profile) => {
        this.savedAddresses.set(profile.savedAddresses ?? []);
        const def = profile.savedAddresses?.find((a) => a.isDefault);
        if (def) this.selectedSavedAddress.set(def);
      },
      error: () => {},
    });

    // Phone: use profile info from persisted user state
    this.phone = user?.phone ?? '';

    // Redirect if nothing to checkout
    if (this.checkoutService.items().length === 0) {
      this.router.navigate(['/products']);
    }
  }

  get isAddressValid(): boolean {
    if (this.selectedSavedAddress()) return true;
    return !!(
      this.houseNo.trim() &&
      this.street.trim() &&
      this.area.trim() &&
      this.city.trim() &&
      this.state &&
      this.pincode.trim().length === 6 &&
      this.manualLat !== null &&
      this.manualLng !== null
    );
  }

  private get composedAddress(): string {
    return [
      this.houseNo.trim(),
      this.street.trim(),
      this.area.trim(),
      this.landmark.trim() ? `Near ${this.landmark.trim()}` : '',
      this.city.trim(),
      `${this.state} - ${this.pincode.trim()}`,
    ]
      .filter(Boolean)
      .join(', ');
  }

  placeOrder(): void {
    this.errorMsg.set('');
    const selectedAddress = this.selectedSavedAddress();
    const deliveryAddress = selectedAddress?.fullAddress ?? this.composedAddress;
    const latitude = selectedAddress?.latitude ?? this.manualLat!;
    const longitude = selectedAddress?.longitude ?? this.manualLng!;
    const request: PlaceOrderRequest = {
      fullName: this.fullName,
      phone: this.phone,
      address: deliveryAddress,
      latitude,
      longitude,
      notes: this.notes,
      items: this.checkoutService.items().map((i) => ({
        productId: i.product.id,
        productName: i.product.name,
        price: i.product.price,
        weight: i.product.weight,
        quantity: i.quantity,
      })),
    };

    this.loading.set(true);
    this.orderService.placeOrder(request).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.orderId.set(res.id);
        this.orderPlaced.set(true);
        this.checkoutService
          .items()
          .forEach((item) => this.cartService.removeFromCart(item.product.id));
        // Save new address if user opted in
        if (
          this.saveNewAddress &&
          this.saveNewAddressLabel.trim() &&
          !this.selectedSavedAddress()
        ) {
          const req: SaveAddressRequest = {
            label: this.saveNewAddressLabel.trim(),
            fullAddress: deliveryAddress,
            latitude,
            longitude,
            isDefault: false,
          };
          this.userService.saveAddress(req).subscribe({ error: () => {} });
        }
        this.checkoutService.clear();
      },
      error: (err) => {
        this.loading.set(false);
        if (err.status === 401) {
          this.errorMsg.set('Session expired. Please login again.');
        } else {
          this.errorMsg.set('Failed to place order. Please try again.');
        }
      },
    });
  }

  selectAddress(addr: SavedAddress): void {
    if (this.selectedSavedAddress()?.label === addr.label) {
      this.selectedSavedAddress.set(null);
    } else {
      this.selectedSavedAddress.set(addr);
    }
  }

  useNewAddress(): void {
    this.selectedSavedAddress.set(null);
  }

  onManualLocationConfirmed(location: { lat: number; lng: number }): void {
    this.manualLat = location.lat;
    this.manualLng = location.lng;
    this.showManualMapPicker.set(false);
  }

  incrementCartQty(index: number): void {
    const item = this.checkoutService.items()[index];
    this.checkoutService.updateQuantity(item.product.id, item.quantity + 1);
  }

  decrementCartQty(index: number): void {
    const item = this.checkoutService.items()[index];
    if (item.quantity <= 1) return;
    this.checkoutService.updateQuantity(item.product.id, item.quantity - 1);
  }

  removeItem(index: number): void {
    const item = this.checkoutService.items()[index];
    this.checkoutService.removeItem(item.product.id);
    if (this.checkoutService.items().length === 0) {
      this.router.navigate(['/cart']);
    }
  }
}
