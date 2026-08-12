import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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
  private readonly _orders = signal<OrderResponse[]>([]);
  private readonly _deliveryPartners = signal<StaffUserResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly orders = this._orders.asReadonly();
  readonly deliveryPartners = this._deliveryPartners.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor(private http: HttpClient) {}

  loadAll(): void {
    this._loading.set(true);
    this._error.set(null);
    this.http.get<OrderResponse[]>(`${this.apiUrl}/admin/all`).subscribe({
      next: (orders) => {
        this._orders.set(orders);
        this._loading.set(false);
      },
      error: () => {
        this._error.set('Failed to load orders');
        this._loading.set(false);
      },
    });
    this.http.get<StaffUserResponse[]>(`${this.apiUrl}/admin/delivery-partners`).subscribe({
      next: (partners) => this._deliveryPartners.set(partners),
      error: () => {},
    });
  }

  placeOrder(request: PlaceOrderRequest): Observable<OrderResponse> {
    return this.http.post<OrderResponse>(this.apiUrl, request);
  }

  getAdminOrders(): Observable<OrderResponse[]> {
    return this.http.get<OrderResponse[]>(`${this.apiUrl}/admin/all`);
  }

  getDeliveryOrders(): Observable<OrderResponse[]> {
    return this.http.get<OrderResponse[]>(`${this.apiUrl}/delivery/my`);
  }

  getDeliveryPartners(): Observable<StaffUserResponse[]> {
    return this.http.get<StaffUserResponse[]>(`${this.apiUrl}/admin/delivery-partners`);
  }

  updateOrderStatusAsAdmin(orderId: string, request: UpdateOrderStatusRequest): Observable<void> {
    return this.http.patch<void>(`${this.apiUrl}/admin/${orderId}/status`, request);
  }

  assignDeliveryPartner(orderId: string, request: AssignDeliveryPartnerRequest): Observable<void> {
    return this.http.patch<void>(`${this.apiUrl}/admin/${orderId}/assign`, request);
  }

  markDelivered(orderId: string): Observable<void> {
    return this.http.patch<void>(`${this.apiUrl}/delivery/${orderId}/delivered`, {});
  }
}