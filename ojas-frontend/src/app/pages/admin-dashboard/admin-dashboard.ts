import { Component, OnInit, signal, computed, effect, inject } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { AuthService } from '../../services/auth.service';
import { OrderService } from '../../services/order.service';
import { ProductService } from '../../services/product.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { CampaignBannerService } from '../../services/campaign-banner.service';
import { ProductManagement } from '../product-management/product-management';
import { DeliveryChargesManagement } from '../delivery-charges-management/delivery-charges-management';
import { CampaignBannerManagement } from '../campaign-banner-management/campaign-banner-management';
import {
  CreateStaffRequest,
  OrderResponse,
  StaffUserResponse,
  UpdateOrderStatusRequest,
  UserRole,
} from '../../models/interfaces';

type AdminTab = 'orders' | 'products' | 'delivery-partners' | 'delivery-charges' | 'campaign-banner';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatChipsModule,
    MatDividerModule,
    CurrencyPipe,
    DatePipe,
    ProductManagement,
    DeliveryChargesManagement,
    CampaignBannerManagement,
  ],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.scss',
})
export class AdminDashboard implements OnInit {
  private authService = inject(AuthService);
  private orderService = inject(OrderService);
  private productService = inject(ProductService);
  private deliveryChargesService = inject(DeliveryChargesService);
  private campaignBannerService = inject(CampaignBannerService);
  private snackBar = inject(MatSnackBar);

  readonly tabs = [
    { id: 'orders', label: 'Orders', icon: 'receipt_long' },
    { id: 'products', label: 'Products', icon: 'inventory_2' },
    { id: 'delivery-partners', label: 'Delivery Partners', icon: 'delivery_dining' },
    { id: 'delivery-charges', label: 'Delivery Charges', icon: 'local_shipping' },
    { id: 'campaign-banner', label: 'Campaign Banner', icon: 'campaign' },
  ] as const;

  readonly activeTab = signal<AdminTab>('orders');

  // Orders tab
  readonly statusOptions = ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
  readonly orders = signal<OrderResponse[]>([]);
  readonly loadingOrders = signal(true);
  readonly ordersError = signal('');
  readonly statusFilter = signal('pending');
  readonly busyOrderAction = signal<string | null>(null);
  readonly statusDraft = signal<Record<string, string>>({});
  readonly deliveryDraft = signal<Record<string, string>>({});

  // Delivery Partners tab
  readonly deliveryPartners = signal<StaffUserResponse[]>([]);
  readonly loadingPartners = signal(true);
  readonly partnersError = signal('');
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

  // Products tab - using ProductManagement component
  readonly productsLoading = computed(() => this.productService.loading());
  readonly productsError = computed(() => this.productService.error());
  readonly productsCount = computed(() => this.productService.products().length);

  // Delivery Charges tab - using DeliveryChargesManagement component
  readonly chargesLoading = computed(() => this.deliveryChargesService.loading());
  readonly chargesConfig = computed(() => this.deliveryChargesService.config());

  // KPIs
  readonly pendingCount = computed(
    () => this.orders().filter((order) => order.status.toLowerCase() === 'pending').length,
  );
  readonly activeDeliveryCount = computed(
    () =>
      this.orders().filter((order) =>
        ['confirmed', 'packed', 'shipped'].includes(order.status.toLowerCase()),
      ).length,
  );
  readonly totalRevenue = computed(
    () =>
      this.orders()
        .filter((o) => o.status.toLowerCase() === 'delivered')
        .reduce((sum, o) => sum + o.totalAmount, 0),
  );

  readonly filteredOrders = computed(() => {
    const filter = this.statusFilter().toLowerCase();
    let filtered = this.orders();
    
    if (filter !== 'all') {
      filtered = filtered.filter((order) => order.status.toLowerCase() === filter);
    }
    
    // Sort: pending first, then by createdAt descending
    return filtered.sort((a, b) => {
      const aPending = a.status.toLowerCase() === 'pending';
      const bPending = b.status.toLowerCase() === 'pending';
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;
      // Both same pending status, sort by date descending
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  });

  ngOnInit(): void {
    this.loadOrders();
    this.loadDeliveryPartners();
  }

  getTabIndex(): number {
    return this.tabs.findIndex((t) => t.id === this.activeTab());
  }

  onTabChange(event: { index: number }): void {
    this.activeTab.set(this.tabs[event.index].id as AdminTab);
  }

  refreshCurrentTab(): void {
    const tab = this.activeTab();
    if (tab === 'orders') {
      this.loadOrders();
    } else if (tab === 'delivery-partners') {
      this.loadDeliveryPartners();
    } else if (tab === 'products') {
      this.productService.loadProducts();
    } else if (tab === 'delivery-charges') {
      this.deliveryChargesService.loadConfig();
    } else if (tab === 'campaign-banner') {
      this.campaignBannerService.loadConfig();
    }
  }

  // Orders tab methods
  loadOrders(): void {
    this.loadingOrders.set(true);
    this.ordersError.set('');

    this.orderService.getAdminOrders().subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.statusDraft.set(this.toStatusDraft(orders));
        this.deliveryDraft.set(this.toDeliveryDraft(orders));
        this.loadingOrders.set(false);
      },
      error: () => {
        this.ordersError.set('Failed to load orders');
        this.loadingOrders.set(false);
      },
    });
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

    this.ordersError.set('');
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
        this.showSuccess('Order status updated');
      },
      error: () => {
        this.ordersError.set('Could not update order status');
        this.busyOrderAction.set(null);
      },
    });
  }

  assignDelivery(order: OrderResponse): void {
    const partnerId = this.deliveryDraft()[order.id] ?? '';
    if (!partnerId || partnerId === order.deliveryPartnerId) return;

    this.ordersError.set('');
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
        this.showSuccess('Delivery partner assigned');
      },
      error: () => {
        this.ordersError.set('Could not assign delivery partner');
        this.busyOrderAction.set(null);
      },
    });
  }

  // Delivery Partners tab methods
  loadDeliveryPartners(): void {
    this.loadingPartners.set(true);
    this.partnersError.set('');

    this.orderService.getDeliveryPartners().subscribe({
      next: (partners: StaffUserResponse[]) => {
        this.deliveryPartners.set(partners);
        this.loadingPartners.set(false);
      },
      error: () => {
        this.partnersError.set('Failed to load delivery partners');
        this.loadingPartners.set(false);
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

    // Basic validation
    if (!payload.fullName.trim() || !payload.email.trim() || !payload.phone.trim() || !payload.password) {
      this.staffError.set('All fields are required');
      return;
    }

    if (!this.isValidEmail(payload.email)) {
      this.staffError.set('Please enter a valid email address');
      return;
    }

    if (payload.password.length < 8) {
      this.staffError.set('Password must be at least 8 characters');
      return;
    }

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
        this.showSuccess('Staff account created');
      },
      error: (err) => {
        this.staffError.set(err?.error?.message ?? 'Could not create staff account.');
        this.creatingStaff.set(false);
      },
    });
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Utility methods
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

  statusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'confirmed': return 'status-confirmed';
      case 'packed': return 'status-packed';
      case 'shipped': return 'status-shipped';
      case 'delivered': return 'status-delivered';
      case 'cancelled': return 'status-cancelled';
      default: return 'status-pending';
    }
  }

  getPartnerName(partnerId: string): string {
    return this.deliveryPartners().find((p) => p.id === partnerId)?.fullName ?? 'Unknown';
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3000, panelClass: 'success-snackbar' });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 5000, panelClass: 'error-snackbar' });
  }

  logout(): void {
    this.authService.logout();
  }
}