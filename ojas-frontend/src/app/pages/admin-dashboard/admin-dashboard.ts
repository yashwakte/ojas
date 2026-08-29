import { Component, OnInit, signal, computed, effect, inject, viewChild } from '@angular/core';
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
  AdminStatusChangeResponse,
  CancellationPreviewResponse,
  CreateStaffRequest,
  OrderResponse,
  Product,
  StaffDeviceResponse,
  StaffUserResponse,
  UpdateOrderStatusRequest,
  UserRole,
  isPaymentOutstanding,
  isPaymentSettled,
  paymentIcon,
  paymentLabel,
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
  /** Shared with the customer and delivery views, so one order isn't described three ways. */
  paymentLabel = paymentLabel;
  paymentIcon = paymentIcon;
  isPaymentSettled = isPaymentSettled;
  isPaymentOutstanding = isPaymentOutstanding;

  private authService = inject(AuthService);
  private orderService = inject(OrderService);
  private productService = inject(ProductService);
  private deliveryChargesService = inject(DeliveryChargesService);
  private campaignBannerService = inject(CampaignBannerService);
  private snackBar = inject(MatSnackBar);
  /** Lets a header Refresh discard an in-progress add/edit form instead of leaving it open with stale data. */
  private readonly productManagement = viewChild(ProductManagement);

  readonly tabs = [
    { id: 'orders', label: 'Orders', shortLabel: 'Orders', icon: 'receipt_long' },
    { id: 'products', label: 'Products', shortLabel: 'Products', icon: 'inventory_2' },
    { id: 'delivery-partners', label: 'Delivery Partners', shortLabel: 'Partners', icon: 'delivery_dining' },
    { id: 'delivery-charges', label: 'Delivery Charges', shortLabel: 'Charges', icon: 'local_shipping' },
    { id: 'campaign-banner', label: 'Campaign Banner', shortLabel: 'Banners', icon: 'campaign' },
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
  /** The cancellation waiting on confirmation, together with what the server says it would hand
   * back. Held rather than asked with confirm() so the figures can actually be shown. */
  readonly cancelPreview = signal<{
    order: OrderResponse;
    preview: CancellationPreviewResponse;
  } | null>(null);

  // Delivery Partners tab
  readonly deliveryPartners = signal<StaffUserResponse[]>([]);
  readonly loadingPartners = signal(true);
  readonly partnersError = signal('');
  readonly staffForm = signal<CreateStaffRequest>({
    fullName: '',
    email: '',
    phone: '',
    role: 'delivery',
  });
  readonly creatingStaff = signal(false);
  readonly staffMessage = signal('');
  readonly staffError = signal('');

  // Staff are restricted to one device each. Keyed by user id so each partner card can show
  // its own binding without a separate request per render.
  readonly staffDevices = signal<Record<string, StaffDeviceResponse[]>>({});
  readonly revokingDeviceFor = signal<string | null>(null);
  readonly resendingInviteFor = signal<string | null>(null);
  readonly approvingDeviceFor = signal<string | null>(null);

  // Populated only outside Production, where the API hands the invite token back instead of
  // relying on a real email. Without this the local flow dead-ends: no mail is sent, so there
  // would be no way to reach the accept-invite page at all.
  readonly devInviteLink = signal<string | null>(null);

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

  /**
   * Orders with unsaved status/delivery-partner changes come first (so an
   * in-progress edit never scrolls out of view), then delivered/cancelled
   * orders sink to the bottom since they're done, and everything else is
   * newest first.
   */
  readonly filteredOrders = computed(() => {
    const filter = this.statusFilter().toLowerCase();
    const all = this.orders();
    const filtered = filter === 'all' ? [...all] : all.filter((order) => order.status.toLowerCase() === filter);

    return filtered.sort((a, b) => {
      const aDirty = this.isDirty(a);
      const bDirty = this.isDirty(b);
      if (aDirty !== bDirty) return aDirty ? -1 : 1;

      const aFinal = this.isFinalStatus(a.status);
      const bFinal = this.isFinalStatus(b.status);
      if (aFinal !== bFinal) return aFinal ? 1 : -1;

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  });

  readonly lowStockProducts = signal<Product[]>([]);
  readonly loadingLowStock = signal(true);

  ngOnInit(): void {
    this.loadOrders();
    this.loadDeliveryPartners();
    this.loadLowStock();
  }

  loadLowStock(): void {
    this.loadingLowStock.set(true);
    this.productService.getLowStock().subscribe({
      next: (products) => {
        this.lowStockProducts.set(products);
        this.loadingLowStock.set(false);
      },
      error: () => {
        this.lowStockProducts.set([]);
        this.loadingLowStock.set(false);
      },
    });
  }

  getTabIndex(): number {
    return this.tabs.findIndex((t) => t.id === this.activeTab());
  }

  onTabChange(event: { index: number }): void {
    this.activeTab.set(this.tabs[event.index].id as AdminTab);
  }

  selectTab(id: AdminTab): void {
    this.activeTab.set(id);
  }

  refreshCurrentTab(): void {
    const tab = this.activeTab();
    if (tab === 'orders') {
      this.loadOrders();
    } else if (tab === 'delivery-partners') {
      this.loadDeliveryPartners();
    } else if (tab === 'products') {
      // Refresh implies "start fresh" — an open add/edit form with unsaved
      // changes would otherwise sit there showing data that's now stale.
      this.productManagement()?.closeForm();
      this.productService.loadProducts();
    } else if (tab === 'delivery-charges') {
      this.deliveryChargesService.loadConfig();
    } else if (tab === 'campaign-banner') {
      this.campaignBannerService.loadCampaigns();
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

  /**
   * Cancelling gives the customer's money back, so it is confirmed against a figure the server
   * works out rather than fired straight off a dropdown. Everything else goes through untouched.
   */
  updateOrderStatus(order: OrderResponse): void {
    const nextStatus = this.statusDraft()[order.id] ?? order.status;
    if (!nextStatus || nextStatus === order.status) return;

    this.ordersError.set('');

    if (nextStatus === 'Cancelled') {
      this.busyOrderAction.set(`${order.id}-status`);
      this.orderService.previewCancellation(order.id).subscribe({
        next: (preview) => {
          this.busyOrderAction.set(null);
          this.cancelPreview.set({ order, preview });
        },
        error: () => {
          this.ordersError.set('Could not work out what cancelling this order would refund');
          this.busyOrderAction.set(null);
        },
      });
      return;
    }

    this.sendStatus(order, nextStatus);
  }

  /** Backs out of the confirmation, putting the dropdown back to where the order actually is so
   * it doesn't sit showing "Cancelled" for an order that wasn't. */
  dismissCancelPreview(): void {
    const pending = this.cancelPreview();
    if (pending) this.setStatusDraft(pending.order.id, pending.order.status);
    this.cancelPreview.set(null);
  }

  confirmCancel(): void {
    const pending = this.cancelPreview();
    if (!pending) return;
    this.cancelPreview.set(null);
    this.sendStatus(pending.order, 'Cancelled');
  }

  private sendStatus(order: OrderResponse, nextStatus: string): void {
    this.busyOrderAction.set(`${order.id}-status`);

    const request: UpdateOrderStatusRequest = { status: nextStatus };
    this.orderService.updateOrderStatusAsAdmin(order.id, request).subscribe({
      next: (result) => {
        // Swapped in whole, never patched: cancelling moves what the order holds, what was
        // refunded and whether a refund is still owed, and patching only the status would leave
        // every one of those showing its pre-cancellation value.
        this.replaceOrder(order.id, result.order);
        this.busyOrderAction.set(null);
        this.showSuccess(this.statusChangeMessage(nextStatus, result));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Cancelling restores stock server-side; refresh so the products
        // list and low-stock widget don't show stale availability.
        if (nextStatus === 'Cancelled') {
          this.productService.loadProducts();
          this.loadLowStock();
          if (result.refundError && result.sourceRefundQueued > 0) {
            this.ordersError.set(
              `The order was cancelled but the refund did not go through: ${result.refundError}. ` +
                'It is listed as owed on the order and can be retried.',
            );
          }
        }
      },
      error: () => {
        this.ordersError.set('Could not update order status');
        this.busyOrderAction.set(null);
      },
    });
  }

  /** Says what actually happened to the money, rather than a bare "status updated" on an action
   * that just refunded someone. */
  private statusChangeMessage(nextStatus: string, result: AdminStatusChangeResponse): string {
    if (nextStatus !== 'Cancelled') return 'Order status updated';

    const parts: string[] = [];
    if (result.refundedToSource > 0)
      parts.push(`${this.money(result.refundedToSource)} refunded to the original payment method`);
    if (result.walletCredited > 0)
      parts.push(`${this.money(result.walletCredited)} returned to the customer's wallet`);
    if (result.sourceRefundQueued > 0)
      parts.push(`${this.money(result.sourceRefundQueued)} still owed — refund it from the order`);

    return parts.length ? `Order cancelled — ${parts.join(', ')}` : 'Order cancelled';
  }

  /** Retries a refund the gateway wouldn't take at cancellation time, or issues the one a
   * cancelling customer asked to have back on their original payment method. */
  refundOwed(order: OrderResponse): void {
    const owed = order.refundPendingAmount ?? 0;
    if (owed <= 0) return;

    this.ordersError.set('');
    this.busyOrderAction.set(`${order.id}-refund`);

    this.orderService.refundToSource(order.id, owed, 'Refund owed on cancelled order').subscribe({
      next: (result) => {
        this.replaceOrder(order.id, result.order);
        this.busyOrderAction.set(null);
        this.showSuccess(`${this.money(result.refunded)} refunded to the original payment method`);
      },
      error: (err: { error?: { message?: string } }) => {
        this.ordersError.set(err?.error?.message ?? 'Could not issue the refund');
        this.busyOrderAction.set(null);
      },
    });
  }

  /** The one place an order in the list is updated. Handlers hand over what the server returned
   * rather than spreading a field or two onto the copy the page already had. */
  private replaceOrder(orderId: string, updated: OrderResponse | null): void {
    if (!updated) {
      this.loadOrders();
      return;
    }
    this.orders.update((orders) => orders.map((item) => (item.id === orderId ? updated : item)));
    this.statusDraft.update((current) => ({ ...current, [orderId]: updated.status }));
  }

  private money(amount: number): string {
    return `₹${amount.toFixed(2)}`;
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
        partners.forEach((partner) => this.loadDevicesFor(partner.id));
      },
      error: () => {
        this.partnersError.set('Failed to load delivery partners');
        this.loadingPartners.set(false);
      },
    });
  }

  private loadDevicesFor(userId: string): void {
    this.authService.getStaffDevices(userId).subscribe({
      next: (devices) => this.staffDevices.update((all) => ({ ...all, [userId]: devices })),
      // A failed lookup shouldn't break the partner list - the card just shows no binding.
      error: () => this.staffDevices.update((all) => ({ ...all, [userId]: [] })),
    });
  }

  deviceFor(userId: string): StaffDeviceResponse | null {
    return this.staffDevices()[userId]?.[0] ?? null;
  }

  // Unbinds a staff member's device and ends their sessions - the recovery path when someone
  // loses their phone. They re-approve a new device by email code on their next sign-in.
  revokeDevice(partner: StaffUserResponse): void {
    if (!confirm(`Sign ${partner.fullName} out and unbind their device?`)) return;

    this.revokingDeviceFor.set(partner.id);
    this.authService.revokeStaffDevice(partner.id).subscribe({
      next: () => {
        this.staffDevices.update((all) => ({ ...all, [partner.id]: [] }));
        this.revokingDeviceFor.set(null);
        this.showSuccess(`${partner.fullName}'s device was unbound`);
      },
      error: () => {
        this.revokingDeviceFor.set(null);
        this.staffError.set('Could not unbind that device. Please try again.');
      },
    });
  }

  // Lets this staff member's next device enroll on password alone, with no OTP email - the
  // break-glass path for when email delivery itself is down.
  approveNextDevice(partner: StaffUserResponse): void {
    this.approvingDeviceFor.set(partner.id);
    this.authService.approveNextDevice(partner.id).subscribe({
      next: (res) => {
        this.approvingDeviceFor.set(null);
        this.deliveryPartners.update((partners) =>
          partners.map((p) =>
            p.id === partner.id ? { ...p, pendingDeviceApprovalExpiresAt: res.expiresAt } : p,
          ),
        );
        this.showSuccess(`${partner.fullName}'s next device will be approved automatically`);
      },
      error: () => {
        this.approvingDeviceFor.set(null);
        this.staffError.set('Could not approve a device for that account. Please try again.');
      },
    });
  }

  private buildDevInviteLink(token: string | null | undefined): string | null {
    return token ? `/accept-invite?token=${encodeURIComponent(token)}` : null;
  }

  // Re-sends the setup link, which invalidates the one from the earlier email.
  resendInvite(partner: StaffUserResponse): void {
    this.resendingInviteFor.set(partner.id);
    this.staffError.set('');

    this.authService.resendStaffInvite(partner.id).subscribe({
      next: (res) => {
        this.resendingInviteFor.set(null);
        this.devInviteLink.set(this.buildDevInviteLink(res.devInviteToken));
        this.showSuccess(`Invite re-sent to ${partner.email}`);
      },
      error: () => {
        this.resendingInviteFor.set(null);
        this.staffError.set('Could not resend that invite. Please try again.');
      },
    });
  }

  updateStaffField<K extends keyof CreateStaffRequest>(key: K, value: CreateStaffRequest[K]): void {
    this.staffForm.update((form) => ({ ...form, [key]: value }));
  }

  createStaffAccount(): void {
    const payload = this.staffForm();
    this.staffError.set('');
    this.staffMessage.set('');

    // Basic validation
    if (!payload.fullName.trim() || !payload.email.trim() || !payload.phone.trim()) {
      this.staffError.set('All fields are required');
      return;
    }

    if (!this.isValidEmail(payload.email)) {
      this.staffError.set('Please enter a valid email address');
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
          role: payload.role,
        });
        this.staffMessage.set(
          `Invite sent to ${createdStaff.email}. They'll set their own password from that link.`,
        );
        this.devInviteLink.set(this.buildDevInviteLink(createdStaff.devInviteToken));
        this.creatingStaff.set(false);
        this.showSuccess('Invite sent');
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

  /** True when this order's status or delivery-partner draft hasn't been saved yet. */
  isDirty(order: OrderResponse): boolean {
    const statusChanged = (this.statusDraft()[order.id] ?? order.status) !== order.status;
    const deliveryChanged = (this.deliveryDraft()[order.id] ?? '') !== (order.deliveryPartnerId ?? '');
    return statusChanged || deliveryChanged;
  }

  private isFinalStatus(status: string): boolean {
    const s = status.toLowerCase();
    return s === 'delivered' || s === 'cancelled';
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
    this.snackBar.open(message, 'Close', { duration: 3000, panelClass: 'snack-success' });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 5000, panelClass: 'snack-error' });
  }

  logout(): void {
    this.authService.logout();
  }
}