import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UserService } from '../../services/user.service';
import { OrderService } from '../../services/order.service';
import { ProductService } from '../../services/product.service';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { OrderEditDraftService } from '../../services/order-edit-draft.service';
import { ChatbotUiService } from '../../services/chatbot-ui.service';
import { MapPicker } from '../../components/map-picker/map-picker';
import { OrderItem, OrderResponse, isOrderEditable } from '../../models/interfaces';

@Component({
  selector: 'app-my-orders',
  imports: [RouterLink, DatePipe, CurrencyPipe, FormsModule, MatIconModule, MatButtonModule, MapPicker],
  templateUrl: './my-orders.html',
  styleUrl: './my-orders.scss',
})
export class MyOrders implements OnInit {
  private readonly userService = inject(UserService);
  private readonly orderService = inject(OrderService);
  private readonly productService = inject(ProductService);
  private readonly deliveryCharges = inject(DeliveryChargesService);
  private readonly orderEditDraft = inject(OrderEditDraftService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly chatbotUi = inject(ChatbotUiService);

  orders = signal<OrderResponse[]>([]);
  loading = signal(true);
  error = signal('');

  /** Id of the order currently open for editing, if any. */
  editingId = signal<string | null>(null);
  editItems = signal<OrderItem[]>([]);
  editPhone = '';
  editNotes = '';
  editAddress = '';
  editLat: number | null = null;
  editLng: number | null = null;
  showEditMap = signal(false);
  saving = signal(false);
  editError = signal('');

  /** Total of the order as it stands on the server, to price the change against. */
  originalTotal = signal(0);
  /** Delivery charge for the currently pinned location, re-quoted as it changes. */
  editDeliveryCharge = signal(0);
  quotingDelivery = signal(false);

  /** What the order will total once saved, at the currently quoted delivery. */
  newTotal = computed(() => this.editItemsTotal() + this.editDeliveryCharge());

  /** Positive = customer owes more, negative = refund due. Drives payment later. */
  amountDifference = computed(() => this.newTotal() - this.originalTotal());

  editItemsTotal = computed(() =>
    this.editItems().reduce((sum, i) => sum + i.price * i.quantity, 0),
  );

  /** Id awaiting cancel confirmation — avoids an accidental one-click cancel. */
  confirmingCancelId = signal<string | null>(null);
  cancelling = signal(false);

  /**
   * Delivered/cancelled orders are done and sink to the bottom; everything
   * else stays on top, newest first. Whatever order is currently being
   * edited is pinned above all of that so the customer never loses track
   * of it mid-edit.
   */
  readonly sortedOrders = computed(() => {
    const editingId = this.editingId();
    const sorted = [...this.orders()].sort((a, b) => {
      const aFinal = this.isFinalStatus(a.status);
      const bFinal = this.isFinalStatus(b.status);
      if (aFinal !== bFinal) return aFinal ? 1 : -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    if (!editingId) return sorted;
    const editIndex = sorted.findIndex((o) => o.id === editingId);
    if (editIndex <= 0) return sorted;
    const [edited] = sorted.splice(editIndex, 1);
    return [edited, ...sorted];
  });

  ngOnInit(): void {
    this.load();
  }

  openChatSupport(): void {
    this.chatbotUi.openChat();
  }

  canModify(order: OrderResponse): boolean {
    return isOrderEditable(order.status);
  }

  startEdit(order: OrderResponse): void {
    this.editingId.set(order.id);
    this.editItems.set(order.items.map((i) => ({ ...i })));
    this.editPhone = order.phone;
    this.editNotes = order.notes;
    this.editAddress = order.address;
    this.editLat = order.latitude;
    this.editLng = order.longitude;
    this.originalTotal.set(order.totalAmount);
    this.editDeliveryCharge.set(order.deliveryCharge);
    this.showEditMap.set(false);
    this.editError.set('');
    this.productService.loadProducts();
    // The order jumps to the top of the list as soon as editing starts;
    // scroll there so the customer sees it move and land in edit mode.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editItems.set([]);
    this.showEditMap.set(false);
    this.editError.set('');
    this.orderEditDraft.clear();
  }

  /** Sends the customer to Products to pick more items, then back here to resume. */
  addMoreProducts(order: OrderResponse): void {
    this.orderEditDraft.begin(order.id, this.editItems());
    this.router.navigate(['/products']);
  }

  /** Restores an in-progress edit after a trip to Products/product-detail to add items. */
  private resumeDraftIfAny(): void {
    const draft = this.orderEditDraft.draft();
    if (!draft) return;
    const order = this.orders().find((o) => o.id === draft.orderId);
    if (!order || !this.canModify(order)) {
      this.orderEditDraft.clear();
      return;
    }
    this.startEdit(order);
    this.editItems.set(draft.items);
    this.orderEditDraft.clear();
  }

  changeQty(index: number, delta: number): void {
    this.editItems.update((items) =>
      items.map((item, i) =>
        i === index ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item,
      ),
    );
  }

  removeItem(index: number): void {
    this.editItems.update((items) => items.filter((_, i) => i !== index));
  }

  onEditLocationConfirmed(location: { lat: number; lng: number; address?: string }): void {
    this.editLat = location.lat;
    this.editLng = location.lng;
    if (location.address) this.editAddress = location.address;
    this.showEditMap.set(false);
    this.requoteDelivery();
  }

  /** Moving the pin can change delivery, so the difference stays honest. */
  private requoteDelivery(): void {
    if (this.editLat === null || this.editLng === null) return;
    this.quotingDelivery.set(true);
    this.deliveryCharges.previewCharge(this.editLat, this.editLng).subscribe({
      next: (quote) => {
        this.editDeliveryCharge.set(quote.charge);
        this.quotingDelivery.set(false);
      },
      error: () => this.quotingDelivery.set(false),
    });
  }

  saveEdit(order: OrderResponse): void {
    if (!this.editItems().length) {
      this.editError.set('An order needs at least one item. Cancel it instead if you no longer want it.');
      return;
    }
    if (this.editLat === null || this.editLng === null) {
      this.editError.set('Please pin your delivery location.');
      return;
    }

    this.saving.set(true);
    this.editError.set('');

    this.orderService
      .updateMyOrder(order.id, {
        fullName: order.fullName,
        phone: this.editPhone,
        address: this.editAddress,
        latitude: this.editLat,
        longitude: this.editLng,
        notes: this.editNotes,
        items: this.editItems(),
      })
      .subscribe({
        next: (updated) => {
          // Swap in the server's version — it owns the recomputed totals.
          this.orders.update((all) => all.map((o) => (o.id === updated.id ? updated : o)));
          this.saving.set(false);
          this.cancelEdit();
          // Item quantities may have changed, shifting stock server-side.
          this.productService.loadProducts();
          this.showSuccess('Order updated');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        error: (err) => {
          this.saving.set(false);
          this.editError.set(
            err.error?.message ?? 'Could not update this order. Please try again.',
          );
          // The window may have closed while they were editing.
          if (err.error?.notEditable) this.load();
        },
      });
  }

  askCancel(orderId: string): void {
    this.confirmingCancelId.set(orderId);
  }

  dismissCancel(): void {
    this.confirmingCancelId.set(null);
  }

  confirmCancel(order: OrderResponse): void {
    this.cancelling.set(true);
    this.orderService.cancelMyOrder(order.id).subscribe({
      next: () => {
        this.orders.update((all) =>
          all.map((o) => (o.id === order.id ? { ...o, status: 'Cancelled' } : o)),
        );
        this.cancelling.set(false);
        this.confirmingCancelId.set(null);
        // Cancelling restores stock server-side; refresh so out-of-stock
        // products the customer bought the last of show as buyable again.
        this.productService.loadProducts();
        this.showSuccess('Order cancelled');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: (err) => {
        this.cancelling.set(false);
        this.confirmingCancelId.set(null);
        this.error.set(err.error?.message ?? 'Could not cancel this order.');
        if (err.error?.notEditable) this.load();
      },
    });
  }

  getStatusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'confirmed':
        return 'status-confirmed';
      case 'packed':
        return 'status-packed';
      case 'delivered':
        return 'status-delivered';
      case 'shipped':
        return 'status-shipped';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-pending';
    }
  }

  private isFinalStatus(status: string): boolean {
    const s = status.toLowerCase();
    return s === 'delivered' || s === 'cancelled';
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3000, panelClass: 'snack-success' });
  }

  private load(): void {
    this.loading.set(true);
    this.userService.getMyOrders().subscribe({
      next: (orders) => {
        this.orders.set(orders);
        this.loading.set(false);
        this.resumeDraftIfAny();
      },
      error: () => {
        this.error.set('Failed to load orders.');
        this.loading.set(false);
      },
    });
  }
}
