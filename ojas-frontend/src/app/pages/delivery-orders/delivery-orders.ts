import { Component, OnInit, computed, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { OrderResponse } from '../../models/interfaces';
import { OrderService } from '../../services/order.service';

@Component({
  selector: 'app-delivery-orders',
  imports: [DatePipe, CurrencyPipe, MatIconModule, MatButtonModule],
  templateUrl: './delivery-orders.html',
  styleUrl: './delivery-orders.scss',
})
export class DeliveryOrders implements OnInit {
  readonly orders = signal<OrderResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly busyOrderId = signal<string | null>(null);
  readonly busyPaymentOrderId = signal<string | null>(null);

  readonly openDeliveries = computed(
    () => this.orders().filter((order) => order.status.toLowerCase() !== 'delivered').length,
  );

  constructor(private orderService: OrderService) {}

  ngOnInit(): void {
    this.fetchOrders();
  }

  markDelivered(orderId: string): void {
    this.error.set('');
    this.busyOrderId.set(orderId);

    this.orderService.markDelivered(orderId).subscribe({
      next: () => {
        this.orders.update((orders) =>
          orders.map((order) =>
            order.id === orderId
              ? { ...order, status: 'Delivered', updatedAt: new Date().toISOString() }
              : order,
          ),
        );
        this.busyOrderId.set(null);
      },
      error: () => {
        this.error.set('Could not mark order as delivered.');
        this.busyOrderId.set(null);
      },
    });
  }

  markPaymentCollected(orderId: string): void {
    this.error.set('');
    this.busyPaymentOrderId.set(orderId);

    this.orderService.markPaymentCollected(orderId).subscribe({
      next: () => {
        this.orders.update((orders) =>
          orders.map((order) =>
            order.id === orderId
              ? { ...order, paymentStatus: 'Collected', updatedAt: new Date().toISOString() }
              : order,
          ),
        );
        this.busyPaymentOrderId.set(null);
      },
      error: () => {
        this.error.set('Could not mark payment as collected.');
        this.busyPaymentOrderId.set(null);
      },
    });
  }

  statusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'confirmed':
        return 'status-confirmed';
      case 'packed':
        return 'status-packed';
      case 'shipped':
        return 'status-shipped';
      case 'delivered':
        return 'status-delivered';
      default:
        return 'status-pending';
    }
  }

  mapUrl(address: string, addressMapLink?: string | null): string {
    const mapLink = (addressMapLink ?? '').trim();
    if (mapLink) {
      return mapLink;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  private fetchOrders(): void {
    this.loading.set(true);
    this.orderService.getDeliveryOrders().subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Unable to load assigned orders.');
        this.loading.set(false);
      },
    });
  }
}
