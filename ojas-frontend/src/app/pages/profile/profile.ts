import { ChangeDetectionStrategy, Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { UserProfileResponse, SaveAddressRequest } from '../../models/interfaces';
import { MapPicker } from '../../components/map-picker/map-picker';
import { INDIAN_STATES } from '../../constants/indian-states';

@Component({
  selector: 'app-profile',
  imports: [
    RouterLink,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatSelectModule,
    MapPicker,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile implements OnInit {
  profile = signal<UserProfileResponse | null>(null);
  loading = signal(true);
  error = signal('');

  // Edit profile
  editingProfile = signal(false);
  editFullName = '';
  editPhone = '';
  savingProfile = signal(false);

  // Add address
  showAddressForm = signal(false);
  newLabel = '';
  newHouseNo = '';
  newStreet = '';
  newArea = '';
  newLandmark = '';
  newCity = '';
  newState = '';
  newPincode = '';
  newLat: number | null = null;
  newLng: number | null = null;
  showNewMapPicker = signal(false);
  newIsDefault = false;
  savingAddress = signal(false);

  // Edit address
  editingAddressIndex = signal<number | null>(null);
  editLabel = '';
  editHouseNo = '';
  editStreet = '';
  editArea = '';
  editLandmark = '';
  editCity = '';
  editState = '';
  editPincode = '';
  editLat: number | null = null;
  editLng: number | null = null;
  showEditMapPicker = signal(false);
  editIsDefault = false;
  savingEditAddress = signal(false);

  readonly indianStates = INDIAN_STATES;

  private snackBar = inject(MatSnackBar);

  // State filtering using signals for performance
  newStateQuery = signal('');
  editStateQuery = signal('');

  readonly filteredNewStates = computed(() => {
    const q = this.newStateQuery().toLowerCase();
    return INDIAN_STATES.filter((s) => s.toLowerCase().includes(q));
  });

  readonly filteredEditStates = computed(() => {
    const q = this.editStateQuery().toLowerCase();
    return INDIAN_STATES.filter((s) => s.toLowerCase().includes(q));
  });

  constructor(
    public auth: AuthService,
    private userService: UserService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadProfile();
  }

  loadProfile(): void {
    this.loading.set(true);
    this.userService.getProfile().subscribe({
      next: (p) => {
        this.profile.set(p);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load profile.');
        this.loading.set(false);
      },
    });
  }

  startEdit(): void {
    const p = this.profile();
    if (!p) return;
    this.editFullName = p.fullName;
    this.editPhone = p.phone;
    this.editingProfile.set(true);
  }

  saveProfile(): void {
    this.savingProfile.set(true);
    this.userService
      .updateProfile({ fullName: this.editFullName, phone: this.editPhone })
      .subscribe({
        next: () => {
          this.auth.updateUserInfo({ fullName: this.editFullName, phone: this.editPhone });
          this.editingProfile.set(false);
          this.savingProfile.set(false);
          this.loadProfile();
        },
        error: (err: HttpErrorResponse) => {
          this.savingProfile.set(false);
          const message =
            err.status === 409
              ? (err.error?.message ?? 'Phone number is already in use.')
              : 'Failed to save changes. Please try again.';
          this.snackBar.open(message, 'Dismiss', {
            duration: 4000,
            panelClass: 'snack-error',
          });
        },
      });
  }

  filterNewStates(value: string): void {
    this.newStateQuery.set(value);
  }

  filterEditStates(value: string): void {
    this.editStateQuery.set(value);
  }

  onStateFocus(type: 'new' | 'edit'): void {
    if (type === 'new') {
      this.newStateQuery.set('');
    } else {
      this.editStateQuery.set('');
    }
  }

  selectState(type: 'new' | 'edit', state: string): void {
    if (type === 'new') {
      this.newState = state;
      this.newStateQuery.set('');
    } else {
      this.editState = state;
      this.editStateQuery.set('');
    }
  }

  get isNewAddressValid(): boolean {
    return !!(
      this.newLabel.trim() &&
      this.newHouseNo.trim() &&
      this.newStreet.trim() &&
      this.newArea.trim() &&
      this.newCity.trim() &&
      INDIAN_STATES.includes(this.newState as any) &&
      this.newPincode.trim().length === 6 &&
      this.newLat !== null &&
      this.newLng !== null
    );
  }

  addAddress(): void {
    if (!this.isNewAddressValid) return;
    this.savingAddress.set(true);
    const fullAddress = [
      this.newHouseNo.trim(),
      this.newStreet.trim(),
      this.newArea.trim(),
      this.newLandmark.trim() ? `Near ${this.newLandmark.trim()}` : '',
      this.newCity.trim(),
      `${this.newState} - ${this.newPincode.trim()}`,
    ]
      .filter(Boolean)
      .join(', ');

    const req: SaveAddressRequest = {
      label: this.newLabel.trim(),
      fullAddress,
      latitude: this.newLat!,
      longitude: this.newLng!,
      isDefault: this.newIsDefault,
    };
    this.userService.saveAddress(req).subscribe({
      next: () => {
        this.cancelAddAddress();
        this.savingAddress.set(false);
        this.loadProfile();
      },
      error: () => this.savingAddress.set(false),
    });
  }

  cancelAddAddress(): void {
    this.showAddressForm.set(false);
    this.newLabel = '';
    this.newHouseNo = '';
    this.newStreet = '';
    this.newArea = '';
    this.newLandmark = '';
    this.newCity = '';
    this.newState = '';
    this.newPincode = '';
    this.newLat = null;
    this.newLng = null;
    this.showNewMapPicker.set(false);
    this.newIsDefault = false;
    this.newStateQuery.set('');
  }

  deleteAddress(index: number): void {
    this.userService.deleteAddress(index).subscribe({
      next: () => this.loadProfile(),
    });
  }

  get isEditAddressValid(): boolean {
    return !!(
      this.editLabel.trim() &&
      this.editHouseNo.trim() &&
      this.editStreet.trim() &&
      this.editArea.trim() &&
      this.editCity.trim() &&
      INDIAN_STATES.includes(this.editState as any) &&
      this.editPincode.trim().length === 6 &&
      this.editLat !== null &&
      this.editLng !== null
    );
  }

  startEditAddress(index: number): void {
    const addr = this.profile()?.savedAddresses?.[index];
    if (!addr) return;
    this.editLabel = addr.label;
    this.editLat = addr.latitude || addr.longitude ? addr.latitude : null;
    this.editLng = addr.latitude || addr.longitude ? addr.longitude : null;
    this.editIsDefault = addr.isDefault;
    this.parseFullAddress(addr.fullAddress);
    this.showAddressForm.set(false);
    this.editingAddressIndex.set(index);
  }

  /** Best-effort parse of composed address string back into fields. */
  private parseFullAddress(fullAddress: string): void {
    this.editHouseNo = '';
    this.editStreet = '';
    this.editArea = '';
    this.editLandmark = '';
    this.editCity = '';
    this.editState = '';
    this.editPincode = '';

    const parts = fullAddress.split(', ');
    if (parts.length < 3) {
      this.editHouseNo = fullAddress;
      return;
    }

    // Last part: "State - Pincode"
    const last = parts[parts.length - 1];
    const statePin = last.match(/^(.+) - (\d{6})$/);
    if (statePin) {
      this.editState = statePin[1];
      this.editPincode = statePin[2];
      parts.pop();
    }

    // City is now last
    this.editCity = parts.pop() ?? '';

    // Landmark part starts with "Near "
    const landmarkIdx = parts.findIndex((p) => p.startsWith('Near '));
    if (landmarkIdx >= 0) {
      this.editLandmark = parts[landmarkIdx].replace(/^Near /, '');
      parts.splice(landmarkIdx, 1);
    }

    this.editHouseNo = parts[0] ?? '';
    this.editStreet = parts[1] ?? '';
    this.editArea = parts.slice(2).join(', ');
  }

  cancelEditAddress(): void {
    this.editingAddressIndex.set(null);
    this.editLabel = '';
    this.editHouseNo = '';
    this.editStreet = '';
    this.editArea = '';
    this.editLandmark = '';
    this.editCity = '';
    this.editState = '';
    this.editPincode = '';
    this.editLat = null;
    this.editLng = null;
    this.showEditMapPicker.set(false);
    this.editIsDefault = false;
    this.editStateQuery.set('');
  }

  saveEditAddress(): void {
    const index = this.editingAddressIndex();
    if (index === null || !this.isEditAddressValid) return;
    this.savingEditAddress.set(true);

    const fullAddress = [
      this.editHouseNo.trim(),
      this.editStreet.trim(),
      this.editArea.trim(),
      this.editLandmark.trim() ? `Near ${this.editLandmark.trim()}` : '',
      this.editCity.trim(),
      `${this.editState} - ${this.editPincode.trim()}`,
    ]
      .filter(Boolean)
      .join(', ');

    this.userService.deleteAddress(index).subscribe({
      next: () => {
        const req: SaveAddressRequest = {
          label: this.editLabel.trim(),
          fullAddress,
          latitude: this.editLat!,
          longitude: this.editLng!,
          isDefault: this.editIsDefault,
        };
        this.userService.saveAddress(req).subscribe({
          next: () => {
            this.cancelEditAddress();
            this.savingEditAddress.set(false);
            this.loadProfile();
          },
          error: () => this.savingEditAddress.set(false),
        });
      },
      error: () => this.savingEditAddress.set(false),
    });
  }

  logout(): void {
    this.auth.logout();
  }

  getInitials(): string {
    const name = this.profile()?.fullName ?? this.auth.user()?.fullName ?? '';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  onNewLocationConfirmed(location: { lat: number; lng: number }): void {
    this.newLat = location.lat;
    this.newLng = location.lng;
    this.showNewMapPicker.set(false);
  }

  onEditLocationConfirmed(location: { lat: number; lng: number }): void {
    this.editLat = location.lat;
    this.editLng = location.lng;
    this.showEditMapPicker.set(false);
  }
}
