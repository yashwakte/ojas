import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AssignDeliveryPartnerRequest,
  CancelOrderResponse,
  CashfreePaymentStatusResponse,
  RefundDestination,
  OrderResponse,
  PlaceOrderRequest,
  StaffUserResponse,
  UpdateMyOrderRequest,
  UpdateMyOrderResponse,
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

  /** Customer edits their own order; allowed until it is Packed. The response carries the money
   * consequences of the edit — a top-up to pay, a refund owed, or a coupon that fell away. */
  updateMyOrder(orderId: string, request: UpdateMyOrderRequest): Observable<UpdateMyOrderResponse> {
    return this.http.put<UpdateMyOrderResponse>(`${this.apiUrl}/my/${orderId}`, request);
  }

  /** Walks away from an edit that was never paid for: the order goes back to exactly what it
   * was, the extra stock is released and nothing is charged. */
  discardAmendment(orderId: string): Observable<OrderResponse> {
    return this.http.delete<OrderResponse>(`${this.apiUrl}/my/${orderId}/amendment`);
  }

  /** Asks the server to check with the payment gateway directly, rather than waiting for the
   * webhook to land in our own database — that wait is what used to make a customer returning
   * from checkout refresh the page by hand to find out whether their payment went through. */
  getCashfreePaymentStatus(orderId: string): Observable<CashfreePaymentStatusResponse> {
    return this.http.get<CashfreePaymentStatusResponse>(
      `${environment.apiUrl}/payments/cashfree/status/${orderId}`,
    );
  }

  /** The customer chooses where money already captured goes back to: wallet credit lands
   * instantly, a refund to the original payment method is queued for an admin. */
  cancelMyOrder(
    orderId: string,
    refundDestination: RefundDestination,
  ): Observable<CancelOrderResponse> {
    return this.http.patch<CancelOrderResponse>(`${this.apiUrl}/my/${orderId}/cancel`, {
      refundDestination,
    });
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

  /** Recorded separately from delivery - a partner can hand over the goods without
   * successfully collecting cash, so the two aren't allowed to imply each other. */
  markPaymentCollected(orderId: string): Observable<void> {
    return this.http.patch<void>(`${this.apiUrl}/delivery/${orderId}/payment-collected`, {});
  }
}
