import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import {
  UserProfileResponse,
  UpdateProfileRequest,
  SaveAddressRequest,
  OrderResponse,
} from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly baseUrl = `${environment.apiUrl}/user`;
  private readonly ordersUrl = `${environment.apiUrl}/orders`;

  constructor(private http: HttpClient) {}

  getProfile() {
    return this.http.get<UserProfileResponse>(`${this.baseUrl}/profile`);
  }

  updateProfile(request: UpdateProfileRequest) {
    return this.http.put(`${this.baseUrl}/profile`, request);
  }

  saveAddress(request: SaveAddressRequest) {
    return this.http.post(`${this.baseUrl}/addresses`, request);
  }

  deleteAddress(index: number) {
    return this.http.delete(`${this.baseUrl}/addresses/${index}`);
  }

  getMyOrders() {
    return this.http.get<OrderResponse[]>(`${this.ordersUrl}/my`);
  }
}
