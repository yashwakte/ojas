import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { Profile } from './profile';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { AuthResponse, UserProfileResponse } from '../../models/interfaces';

describe('Profile', () => {
  const authUser: AuthResponse = {
    id: 'u1',
    fullName: 'Jane Doe',
    email: 'jane@x.com',
    phone: '9999999999',
    role: 'customer',
  };

  const profile: UserProfileResponse = {
    id: 'u1',
    fullName: 'Jane Doe',
    email: 'jane@x.com',
    phone: '9999999999',
    createdAt: '2024-01-01',
    savedAddresses: [
      {
        label: 'Home',
        fullAddress: '12, Main St, Area, Near Landmark, Pune, Maharashtra - 411001',
        latitude: 18.5,
        longitude: 73.8,
        isDefault: true,
      },
    ],
  };

  let authServiceSpy: any;
  let userServiceSpy: jasmine.SpyObj<UserService>;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let router: Router;

  beforeEach(() => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['isLoggedIn', 'updateUserInfo', 'logout'], {
      user: signal<AuthResponse | null>(authUser),
    });
    authServiceSpy.isLoggedIn.and.returnValue(true);
    userServiceSpy = jasmine.createSpyObj('UserService', ['getProfile', 'updateProfile', 'saveAddress', 'deleteAddress']);
    userServiceSpy.getProfile.and.returnValue(of(profile));
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      imports: [Profile],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceSpy },
        { provide: UserService, useValue: userServiceSpy },
        { provide: MatSnackBar, useValue: snackBarSpy },
      ],
    });
    router = TestBed.inject(Router);
  });

  function create() {
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    return fixture;
  }

  it('redirects to /login when not logged in and skips loading the profile', () => {
    authServiceSpy.isLoggedIn.and.returnValue(false);
    spyOn(router, 'navigate');
    create();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(userServiceSpy.getProfile).not.toHaveBeenCalled();
  });

  it('loads the profile on init when logged in', () => {
    const fixture = create();
    expect(fixture.componentInstance.profile()).toEqual(profile);
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('sets an error when loading the profile fails', () => {
    userServiceSpy.getProfile.and.returnValue(throwError(() => new Error('fail')));
    const fixture = create();
    expect(fixture.componentInstance.error()).toBe('Failed to load profile.');
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('startEdit populates edit fields from the current profile', () => {
    const fixture = create();
    fixture.componentInstance.startEdit();
    expect(fixture.componentInstance.editFullName).toBe('Jane Doe');
    expect(fixture.componentInstance.editEmail).toBe('jane@x.com');
    expect(fixture.componentInstance.editPhone).toBe('9999999999');
    expect(fixture.componentInstance.editingProfile()).toBeTrue();
  });

  it('saveProfile updates auth info, exits edit mode, and reloads the profile on success', () => {
    userServiceSpy.updateProfile.and.returnValue(of({}));
    const fixture = create();
    fixture.componentInstance.startEdit();
    fixture.componentInstance.editFullName = 'New Name';

    fixture.componentInstance.saveProfile();

    expect(authServiceSpy.updateUserInfo).toHaveBeenCalledWith({
      fullName: 'New Name',
      email: 'jane@x.com',
      phone: '9999999999',
    });
    expect(fixture.componentInstance.editingProfile()).toBeFalse();
    expect(fixture.componentInstance.savingProfile()).toBeFalse();
  });

  it('saveProfile shows a duplicate-contact message on 409', () => {
    userServiceSpy.updateProfile.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'Email taken' } })),
    );
    const fixture = create();
    fixture.componentInstance.startEdit();

    fixture.componentInstance.saveProfile();

    expect(snackBarSpy.open).toHaveBeenCalledWith('Email taken', 'Dismiss', jasmine.any(Object));
    expect(fixture.componentInstance.savingProfile()).toBeFalse();
  });

  it('saveProfile shows a generic error message on other failures', () => {
    userServiceSpy.updateProfile.and.returnValue(throwError(() => ({ status: 500 })));
    const fixture = create();
    fixture.componentInstance.startEdit();

    fixture.componentInstance.saveProfile();

    expect(snackBarSpy.open).toHaveBeenCalledWith(
      'Failed to save changes. Please try again.',
      'Dismiss',
      jasmine.any(Object),
    );
  });

  it('filterNewStates/filterEditStates narrow the filtered state lists', () => {
    const fixture = create();
    fixture.componentInstance.filterNewStates('mahar');
    expect(fixture.componentInstance.filteredNewStates()).toEqual(['Maharashtra']);

    fixture.componentInstance.filterEditStates('kerala');
    expect(fixture.componentInstance.filteredEditStates()).toEqual(['Kerala']);
  });

  it('selectState sets the chosen state and clears the query', () => {
    const fixture = create();
    fixture.componentInstance.selectState('new', 'Goa');
    expect(fixture.componentInstance.newState).toBe('Goa');
    expect(fixture.componentInstance.newStateQuery()).toBe('');

    fixture.componentInstance.selectState('edit', 'Kerala');
    expect(fixture.componentInstance.editState).toBe('Kerala');
    expect(fixture.componentInstance.editStateQuery()).toBe('');
  });

  it('isNewAddressValid requires all fields plus valid coordinates and a real state', () => {
    const fixture = create();
    expect(fixture.componentInstance.isNewAddressValid).toBeFalse();

    fixture.componentInstance.newLabel = 'Home';
    fixture.componentInstance.newHouseNo = '1';
    fixture.componentInstance.newStreet = 'St';
    fixture.componentInstance.newArea = 'Area';
    fixture.componentInstance.newCity = 'Pune';
    fixture.componentInstance.newState = 'Maharashtra';
    fixture.componentInstance.newPincode = '411001';
    fixture.componentInstance.newLat = 18.5;
    fixture.componentInstance.newLng = 73.8;

    expect(fixture.componentInstance.isNewAddressValid).toBeTrue();
  });

  it('addAddress is a no-op when the form is invalid', () => {
    const fixture = create();
    fixture.componentInstance.addAddress();
    expect(userServiceSpy.saveAddress).not.toHaveBeenCalled();
  });

  it('addAddress composes the address and saves it, then resets and reloads on success', () => {
    userServiceSpy.saveAddress.and.returnValue(of({}));
    const fixture = create();
    fixture.componentInstance.newLabel = 'Home';
    fixture.componentInstance.newHouseNo = '1';
    fixture.componentInstance.newStreet = 'St';
    fixture.componentInstance.newArea = 'Area';
    fixture.componentInstance.newCity = 'Pune';
    fixture.componentInstance.newState = 'Maharashtra';
    fixture.componentInstance.newPincode = '411001';
    fixture.componentInstance.newLat = 18.5;
    fixture.componentInstance.newLng = 73.8;

    fixture.componentInstance.addAddress();

    expect(userServiceSpy.saveAddress).toHaveBeenCalledWith(
      jasmine.objectContaining({ label: 'Home', latitude: 18.5, longitude: 73.8 }),
    );
    expect(fixture.componentInstance.showAddressForm()).toBeFalse();
    expect(fixture.componentInstance.savingAddress()).toBeFalse();
  });

  it('cancelAddAddress resets all the new-address fields', () => {
    const fixture = create();
    fixture.componentInstance.newLabel = 'X';
    fixture.componentInstance.newLat = 1;
    fixture.componentInstance.showAddressForm.set(true);

    fixture.componentInstance.cancelAddAddress();

    expect(fixture.componentInstance.newLabel).toBe('');
    expect(fixture.componentInstance.newLat).toBeNull();
    expect(fixture.componentInstance.showAddressForm()).toBeFalse();
  });

  it('deleteAddress calls the service and reloads the profile', () => {
    userServiceSpy.deleteAddress.and.returnValue(of({}));
    const fixture = create();
    userServiceSpy.getProfile.calls.reset();

    fixture.componentInstance.deleteAddress(0);

    expect(userServiceSpy.deleteAddress).toHaveBeenCalledWith(0);
    expect(userServiceSpy.getProfile).toHaveBeenCalled();
  });

  it('startEditAddress parses the composed address back into fields', () => {
    const fixture = create();
    fixture.componentInstance.startEditAddress(0);

    expect(fixture.componentInstance.editLabel).toBe('Home');
    expect(fixture.componentInstance.editCity).toBe('Pune');
    expect(fixture.componentInstance.editState).toBe('Maharashtra');
    expect(fixture.componentInstance.editPincode).toBe('411001');
    expect(fixture.componentInstance.editLandmark).toBe('Landmark');
    expect(fixture.componentInstance.editingAddressIndex()).toBe(0);
  });

  it('cancelEditAddress resets the edit-address fields', () => {
    const fixture = create();
    fixture.componentInstance.startEditAddress(0);

    fixture.componentInstance.cancelEditAddress();

    expect(fixture.componentInstance.editingAddressIndex()).toBeNull();
    expect(fixture.componentInstance.editLabel).toBe('');
  });

  it('saveEditAddress deletes the old entry, re-saves, and reloads on success', () => {
    userServiceSpy.deleteAddress.and.returnValue(of({}));
    userServiceSpy.saveAddress.and.returnValue(of({}));
    const fixture = create();
    fixture.componentInstance.startEditAddress(0);

    fixture.componentInstance.saveEditAddress();

    expect(userServiceSpy.deleteAddress).toHaveBeenCalledWith(0);
    expect(userServiceSpy.saveAddress).toHaveBeenCalled();
    expect(fixture.componentInstance.editingAddressIndex()).toBeNull();
  });

  it('logout delegates to auth.logout()', () => {
    const fixture = create();
    fixture.componentInstance.logout();
    expect(authServiceSpy.logout).toHaveBeenCalled();
  });

  it('getInitials prefers the profile name, falling back to the auth user', () => {
    const fixture = create();
    expect(fixture.componentInstance.getInitials()).toBe('JD');
  });

  it('onNewLocationConfirmed / onEditLocationConfirmed set coordinates and hide their pickers', () => {
    const fixture = create();
    fixture.componentInstance.showNewMapPicker.set(true);
    fixture.componentInstance.onNewLocationConfirmed({ lat: 1, lng: 2 });
    expect(fixture.componentInstance.newLat).toBe(1);
    expect(fixture.componentInstance.newLng).toBe(2);
    expect(fixture.componentInstance.showNewMapPicker()).toBeFalse();

    fixture.componentInstance.showEditMapPicker.set(true);
    fixture.componentInstance.onEditLocationConfirmed({ lat: 3, lng: 4 });
    expect(fixture.componentInstance.editLat).toBe(3);
    expect(fixture.componentInstance.editLng).toBe(4);
    expect(fixture.componentInstance.showEditMapPicker()).toBeFalse();
  });
});
