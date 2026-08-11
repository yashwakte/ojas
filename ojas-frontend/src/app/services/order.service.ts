import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import {
  AssignDeliveryPartnerRequest,
  OrderResponse,
  PlaceOrderRequest,
  StaffUserResponse,
  UpdateOrderStatusRequest,
} from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly apiUrl = `${environment.apiUrl}/orders`;

  constructor(private http: HttpClient) {}

  placeOrder(request: PlaceOrderRequest) {
    return this.http.post<OrderResponse>(this.apiUrl, request);
  }

  getAdminOrders() {
    return this.http.get<OrderResponse[]>(`${this.apiUrl}/admin/all`);
  }

  getDeliveryOrders() {
    return this.http.get<OrderResponse[]>(`${this.apiUrl}/delivery/my`);
  }

  getDeliveryPartners() {
    return this.http.get<StaffUserResponse[]>(`${this.apiUrl}/admin/delivery-partners`);
  }

  updateOrderStatusAsAdmin(orderId: string, request: UpdateOrderStatusRequest) {
    return this.http.patch<void>(`${this.apiUrl}/admin/${orderId}/status`, request);
  }

  assignDeliveryPartner(orderId: string, request: AssignDeliveryPartnerRequest) {
    return this.http.patch<void>(`${this.apiUrl}/admin/${orderId}/assign`, request);
  }

  markDelivered(orderId: string) {
    return this.http.patch<void>(`${this.apiUrl}/delivery/${orderId}/delivered`, {});
  }
}
