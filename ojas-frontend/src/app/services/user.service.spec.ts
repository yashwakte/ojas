import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UserService } from './user.service';
import { environment } from '../../environments/environment';
import { UserProfileResponse, UpdateProfileRequest, SaveAddressRequest, OrderResponse } from '../models/interfaces';

describe('UserService', () => {
  let service: UserService;
  let httpMock: HttpTestingController;

  const profile: UserProfileResponse = {
    id: 'u1',
    fullName: 'Jane',
    email: 'jane@x.com',
    phone: '9999999999',
    createdAt: '2024-01-01',
    savedAddresses: [],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getProfile() gets /user/profile', () => {
    service.getProfile().subscribe((res) => expect(res).toEqual(profile));
    const req = httpMock.expectOne(`${environment.apiUrl}/user/profile`);
    expect(req.request.method).toBe('GET');
    req.flush(profile);
  });

  it('updateProfile() puts to /user/profile', () => {
    const request: UpdateProfileRequest = { fullName: 'Jane D', email: 'jane@x.com', phone: '9999999999' };
    service.updateProfile(request).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/user/profile`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(request);
    req.flush({});
  });

  it('saveAddress() posts to /user/addresses', () => {
    const request: SaveAddressRequest = {
      label: 'Home',
      fullAddress: '123 Street',
      latitude: 18.5,
      longitude: 73.8,
      isDefault: true,
    };
    service.saveAddress(request).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/user/addresses`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush({});
  });

  it('deleteAddress() deletes /user/addresses/:index', () => {
    service.deleteAddress(2).subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/user/addresses/2`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  it('getMyOrders() gets /orders/my', () => {
    const orders: OrderResponse[] = [];
    service.getMyOrders().subscribe((res) => expect(res).toEqual(orders));
    const req = httpMock.expectOne(`${environment.apiUrl}/orders/my`);
    expect(req.request.method).toBe('GET');
    req.flush(orders);
  });
});
