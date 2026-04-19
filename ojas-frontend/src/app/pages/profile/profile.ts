import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { UserProfileResponse, SaveAddressRequest } from '../../models/interfaces';

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
    MatAutocompleteModule,
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
  editIsDefault = false;
  savingEditAddress = signal(false);

  filteredNewStates: string[] = [];
  filteredEditStates: string[] = [];

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

  constructor(
    public auth: AuthService,
    private userService: UserService,
    private router: Router,
  ) {
    this.filteredNewStates = [...this.indianStates];
    this.filteredEditStates = [...this.indianStates];
  }

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
          this.editingProfile.set(false);
          this.savingProfile.set(false);
          this.loadProfile();
        },
        error: () => this.savingProfile.set(false),
      });
  }

  filterNewStates(value: string): void {
    const q = (value ?? '').toLowerCase();
    this.filteredNewStates = this.indianStates.filter((s) => s.toLowerCase().includes(q));
  }

  filterEditStates(value: string): void {
    const q = (value ?? '').toLowerCase();
    this.filteredEditStates = this.indianStates.filter((s) => s.toLowerCase().includes(q));
  }

  get isNewAddressValid(): boolean {
    return !!(
      this.newLabel.trim() &&
      this.newHouseNo.trim() &&
      this.newStreet.trim() &&
      this.newArea.trim() &&
      this.newCity.trim() &&
      this.indianStates.includes(this.newState) &&
      this.newPincode.trim().length === 6
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
    this.newIsDefault = false;
    this.filteredNewStates = [...this.indianStates];
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
      this.indianStates.includes(this.editState) &&
      this.editPincode.trim().length === 6
    );
  }

  startEditAddress(index: number): void {
    const addr = this.profile()?.savedAddresses?.[index];
    if (!addr) return;
    this.editLabel = addr.label;
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
    this.editIsDefault = false;
    this.filteredEditStates = [...this.indianStates];
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
}
