import { Component, OnInit, computed, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import {
  CreateStaffRequest,
  OrderResponse,
  StaffUserResponse,
  UpdateOrderStatusRequest,
} from '../../models/interfaces';
import { OrderService } from '../../services/order.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin-orders',
  imports: [FormsModule, MatIconModule, MatButtonModule, DatePipe, CurrencyPipe],
  templateUrl: './admin-orders.html',
  styleUrl: './admin-orders.scss',
})
export class AdminOrders implements OnInit {
  readonly statusOptions = ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];

  readonly orders = signal<OrderResponse[]>([]);
  readonly deliveryPartners = signal<StaffUserResponse[]>([]);
  readonly loading = signal(true);
  readonly busyOrderAction = signal<string | null>(null);
  readonly error = signal('');
  readonly statusFilter = signal('all');

  readonly staffForm = signal<CreateStaffRequest>({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: 'delivery',
  });
  readonly creatingStaff = signal(false);
  readonly staffMessage = signal('');
  readonly staffError = signal('');
  readonly showStaffPassword = signal(false);

  readonly statusDraft = signal<Record<string, string>>({});
  readonly deliveryDraft = signal<Record<string, string>>({});

  readonly filteredOrders = computed(() => {
    const filter = this.statusFilter().toLowerCase();
    if (filter === 'all') return this.orders();
    return this.orders().filter((order) => order.status.toLowerCase() === filter);
  });

  readonly pendingCount = computed(
    () => this.orders().filter((order) => order.status.toLowerCase() === 'pending').length,
  );
  readonly activeDeliveryCount = computed(
    () =>
      this.orders().filter((order) =>
        ['confirmed', 'packed', 'shipped'].includes(order.status.toLowerCase()),
      ).length,
  );

  constructor(
    private orderService: OrderService,
    private authService: AuthService,
  ) {}

  ngOnInit(): void {
    this.loadDashboard();
  }

  setStatusFilter(value: string): void {
    this.statusFilter.set(value);
  }

  setStatusDraft(orderId: string, value: string): void {
    this.statusDraft.update((current) => ({ ...current, [orderId]: value }));
  }

  setDeliveryDraft(orderId: string, value: string): void {
    this.deliveryDraft.update((current) => ({ ...current, [orderId]: value }));
  }

  updateOrderStatus(order: OrderResponse): void {
    const nextStatus = this.statusDraft()[order.id] ?? order.status;
    if (!nextStatus || nextStatus === order.status) return;

    this.error.set('');
    this.busyOrderAction.set(`${order.id}-status`);

    const request: UpdateOrderStatusRequest = { status: nextStatus };
    this.orderService.updateOrderStatusAsAdmin(order.id, request).subscribe({
      next: () => {
        this.orders.update((orders) =>
          orders.map((item) =>
            item.id === order.id
              ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() }
              : item,
          ),
        );
        this.busyOrderAction.set(null);
      },
      error: () => {
        this.error.set('Could not update order status. Please try again.');
        this.busyOrderAction.set(null);
      },
    });
  }

  assignDelivery(order: OrderResponse): void {
    const partnerId = this.deliveryDraft()[order.id] ?? '';
    if (!partnerId || partnerId === order.deliveryPartnerId) return;

    this.error.set('');
    this.busyOrderAction.set(`${order.id}-assign`);

    this.orderService.assignDeliveryPartner(order.id, { deliveryPartnerId: partnerId }).subscribe({
      next: () => {
        const partnerName = this.deliveryPartners().find((partner) => partner.id === partnerId)?.fullName;
        this.orders.update((orders) =>
          orders.map((item) =>
            item.id === order.id
              ? {
                  ...item,
                  deliveryPartnerId: partnerId,
                  deliveryPartnerName: partnerName ?? null,
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
        this.busyOrderAction.set(null);
      },
      error: () => {
        this.error.set('Could not assign delivery partner. Please try again.');
        this.busyOrderAction.set(null);
      },
    });
  }

  updateStaffField<K extends keyof CreateStaffRequest>(key: K, value: CreateStaffRequest[K]): void {
    this.staffForm.update((form) => ({ ...form, [key]: value }));
  }

  toggleStaffPasswordVisibility(): void {
    this.showStaffPassword.update((visible) => !visible);
  }

  createStaffAccount(): void {
    const payload = this.staffForm();
    this.staffError.set('');
    this.staffMessage.set('');

    this.creatingStaff.set(true);
    this.authService.createStaff(payload).subscribe({
      next: (createdStaff) => {
        if (createdStaff.role === 'delivery') {
          this.deliveryPartners.update((partners) => [...partners, createdStaff]);
        }

        this.staffForm.set({
          fullName: '',
          email: '',
          phone: '',
          password: '',
          role: payload.role,
        });
        this.staffMessage.set(`${createdStaff.fullName} created successfully.`);
        this.creatingStaff.set(false);
      },
      error: (err) => {
        this.staffError.set(err?.error?.message ?? 'Could not create staff account.');
        this.creatingStaff.set(false);
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
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-pending';
    }
  }

  private loadDashboard(): void {
    this.loading.set(true);
    this.error.set('');

    this.orderService.getAdminOrders().subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.statusDraft.set(this.toStatusDraft(orders));
        this.deliveryDraft.set(this.toDeliveryDraft(orders));

        this.orderService.getDeliveryPartners().subscribe({
          next: (partners) => {
            this.deliveryPartners.set(partners);
            this.loading.set(false);
          },
          error: () => {
            this.error.set('Orders loaded, but delivery partner list failed to load.');
            this.loading.set(false);
          },
        });
      },
      error: () => {
        this.error.set('Failed to load admin dashboard.');
        this.loading.set(false);
      },
    });
  }

  private toStatusDraft(orders: OrderResponse[]): Record<string, string> {
    return orders.reduce<Record<string, string>>((acc, order) => {
      acc[order.id] = order.status;
      return acc;
    }, {});
  }

  private toDeliveryDraft(orders: OrderResponse[]): Record<string, string> {
    return orders.reduce<Record<string, string>>((acc, order) => {
      acc[order.id] = order.deliveryPartnerId ?? '';
      return acc;
    }, {});
  }
}
