import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { OrderResponse, PlaceOrderRequest } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly apiUrl = `${environment.apiUrl}/orders`;

  constructor(private http: HttpClient) {}

  placeOrder(request: PlaceOrderRequest) {
    return this.http.post<OrderResponse>(this.apiUrl, request);
  }
}
