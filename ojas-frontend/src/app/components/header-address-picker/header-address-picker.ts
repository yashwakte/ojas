import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { DeliveryAddressService } from '../../services/delivery-address.service';
import { SavedAddress } from '../../models/interfaces';

/**
 * The "deliver to" control that lives in the header once an address has been
 * chosen — quick switching between saved addresses without leaving the page,
 * falling back to the full address picker sheet to add a new one.
 */
@Component({
  selector: 'app-header-address-picker',
  imports: [MatIconModule],
  templateUrl: './header-address-picker.html',
  styleUrl: './header-address-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderAddressPicker {
  private readonly auth = inject(AuthService);
  private readonly users = inject(UserService);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly deliveryAddress = inject(DeliveryAddressService);

  protected readonly open = signal(false);
  protected readonly savedAddresses = signal<SavedAddress[]>([]);
  protected readonly loadingSaved = signal(false);

  toggle(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    this.open.set(true);
    if (this.auth.isLoggedIn()) {
      this.loadSaved();
    }
  }

  choose(address: SavedAddress): void {
    this.deliveryAddress.select(address);
    this.open.set(false);
  }

  addNew(): void {
    this.open.set(false);
    this.deliveryAddress.openPicker();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  private loadSaved(): void {
    this.loadingSaved.set(true);
    this.users.getProfile().subscribe({
      next: (profile) => {
        this.savedAddresses.set(profile.savedAddresses ?? []);
        this.loadingSaved.set(false);
      },
      error: () => {
        this.savedAddresses.set([]);
        this.loadingSaved.set(false);
      },
    });
  }
}
