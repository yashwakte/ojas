import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import {
  UserProfileResponse,
  UpdateProfileRequest,
  SaveAddressRequest,
  OrderResponse,
  SendEmailCodeRequest,
  VerifyEmailCodeRequest,
  StartPhoneChangeRequest,
  VerifyPhoneChangeRequest,
  ContactCodeSentResponse,
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

  /** Emails a 6-digit code to `email` - the account's own address to confirm it, or a new one
   * (with the current password) to move the account to it. */
  sendEmailCode(request: SendEmailCodeRequest) {
    return this.http.post<ContactCodeSentResponse>(`${this.baseUrl}/email/send-code`, request);
  }

  /** Answers with the updated profile: the email verified, and replaced if it was a new one. */
  verifyEmailCode(request: VerifyEmailCodeRequest) {
    return this.http.post<UserProfileResponse>(`${this.baseUrl}/email/verify`, request);
  }

  /** Checks the password and reserves the number. The text itself is sent by MSG91's widget. */
  startPhoneChange(request: StartPhoneChangeRequest) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/phone/start`, request);
  }

  verifyPhoneChange(request: VerifyPhoneChangeRequest) {
    return this.http.post<UserProfileResponse>(`${this.baseUrl}/phone/verify`, request);
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
