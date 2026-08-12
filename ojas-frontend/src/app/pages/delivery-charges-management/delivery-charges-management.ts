import { Component, OnInit, signal, computed, effect, inject } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { DeliveryChargesConfig, UpdateDeliveryChargesRequest } from '../../models/interfaces';

@Component({
  selector: 'app-delivery-charges-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatSlideToggleModule,
    MatDividerModule,
    MatChipsModule,
    CurrencyPipe,
  ],
  templateUrl: './delivery-charges-management.html',
  styleUrl: './delivery-charges-management.scss',
})
export class DeliveryChargesManagement implements OnInit {
  private deliveryChargesService = inject(DeliveryChargesService);
  private snackBar = inject(MatSnackBar);

  readonly config = computed(() => this.deliveryChargesService.config());
  readonly loading = computed(() => this.deliveryChargesService.loading());
  readonly error = computed(() => this.deliveryChargesService.error());

  readonly editing = signal(false);
  readonly submitting = signal(false);
  readonly testDistance = signal<number | null>(null);
  readonly testResult = signal<{ charge: number; isFree: boolean; breakdown: string } | null>(null);
  readonly testDistanceInput = signal<number | null>(null);

  readonly formData = signal<UpdateDeliveryChargesRequest>({
    warehouseAddress: 'Sangvi, Pune, Maharashtra, India',
    warehouseLatitude: 18.5672,
    warehouseLongitude: 73.7793,
    freeDeliveryUpToKm: 7,
    perKmChargeAfterFree: 10,
    isActive: true,
  });

  readonly formErrors = signal<Partial<Record<keyof UpdateDeliveryChargesRequest, string>>>({});

  readonly distanceExamples = [1, 3, 5, 7, 8, 10, 15, 20, 30, 50];

  constructor() {
    effect(() => {
      const cfg = this.config();
      if (cfg && !this.editing()) {
        this.formData.set({
          warehouseAddress: cfg.warehouseAddress,
          warehouseLatitude: cfg.warehouseLatitude,
          warehouseLongitude: cfg.warehouseLongitude,
          freeDeliveryUpToKm: cfg.freeDeliveryUpToKm,
          perKmChargeAfterFree: cfg.perKmChargeAfterFree,
          isActive: cfg.isActive,
        });
      }
    });
  }

  ngOnInit(): void {
    this.deliveryChargesService.loadConfig();
  }

  startEditing(): void {
    this.editing.set(true);
    this.formErrors.set({});
  }

  cancelEditing(): void {
    this.editing.set(false);
    const cfg = this.config();
    if (cfg) {
      this.formData.set({
        warehouseAddress: cfg.warehouseAddress,
        warehouseLatitude: cfg.warehouseLatitude,
        warehouseLongitude: cfg.warehouseLongitude,
        freeDeliveryUpToKm: cfg.freeDeliveryUpToKm,
        perKmChargeAfterFree: cfg.perKmChargeAfterFree,
        isActive: cfg.isActive,
      });
    }
    this.formErrors.set({});
  }

  validateForm(): boolean {
    const errors: Partial<Record<keyof UpdateDeliveryChargesRequest, string>> = {};
    const data = this.formData();

    if (data.warehouseAddress !== undefined) {
      if (!data.warehouseAddress.trim()) {
        errors.warehouseAddress = 'Warehouse address is required';
      } else if (data.warehouseAddress.trim().length < 5) {
        errors.warehouseAddress = 'Address must be at least 5 characters';
      } else if (data.warehouseAddress.trim().length > 200) {
        errors.warehouseAddress = 'Address must not exceed 200 characters';
      }
    }

    if (data.warehouseLatitude !== undefined) {
      if (isNaN(data.warehouseLatitude) || data.warehouseLatitude < -90 || data.warehouseLatitude > 90) {
        errors.warehouseLatitude = 'Latitude must be between -90 and 90';
      }
    }

    if (data.warehouseLongitude !== undefined) {
      if (isNaN(data.warehouseLongitude) || data.warehouseLongitude < -180 || data.warehouseLongitude > 180) {
        errors.warehouseLongitude = 'Longitude must be between -180 and 180';
      }
    }

    if (data.freeDeliveryUpToKm !== undefined) {
      if (isNaN(data.freeDeliveryUpToKm) || data.freeDeliveryUpToKm < 0) {
        errors.freeDeliveryUpToKm = 'Free delivery distance must be 0 or greater';
      } else if (data.freeDeliveryUpToKm > 500) {
        errors.freeDeliveryUpToKm = 'Free delivery distance seems too high (max 500 km)';
      }
    }

    if (data.perKmChargeAfterFree !== undefined) {
      if (isNaN(data.perKmChargeAfterFree) || data.perKmChargeAfterFree < 0) {
        errors.perKmChargeAfterFree = 'Per km charge must be 0 or greater';
      } else if (data.perKmChargeAfterFree > 1000) {
        errors.perKmChargeAfterFree = 'Per km charge seems too high (max ₹1000/km)';
      }
    }

    this.formErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  saveConfig(): void {
    if (!this.validateForm()) {
      this.showError('Please fix the validation errors');
      return;
    }

    this.submitting.set(true);
    const data = this.sanitizeFormData(this.formData());

    this.deliveryChargesService.updateConfig(data).subscribe({
      next: (updatedConfig) => {
        this.showSuccess('Delivery charges configuration updated successfully');
        this.editing.set(false);
        this.formErrors.set({});
        this.submitting.set(false);
      },
      error: (err) => {
        this.showError(err?.error?.message ?? 'Failed to update delivery charges configuration');
        this.submitting.set(false);
      },
    });
  }

  toggleActive(event: { checked: boolean }): void {
    this.formData.update(d => ({ ...d, isActive: event.checked }));
    this.saveConfig();
  }

  isFreeDelivery(distance: number): boolean {
    const cfg = this.config();
    if (!cfg || !cfg.isActive) return true;
    return distance <= cfg.freeDeliveryUpToKm;
  }

  calculateCharge(distance: number): number {
    const result = this.deliveryChargesService.calculateDeliveryCharge(distance);
    return result.charge;
  }

  getBreakdown(distance: number): string {
    const result = this.deliveryChargesService.calculateDeliveryCharge(distance);
    return result.breakdown;
  }

  testDistanceCalculation(distance: number): void {
    this.testDistance.set(distance);
    const result = this.deliveryChargesService.calculateDeliveryCharge(distance);
    this.testResult.set(result);
  }

  clearTest(): void {
    this.testDistance.set(null);
    this.testDistanceInput.set(null);
    this.testResult.set(null);
  }

  private sanitizeFormData(data: UpdateDeliveryChargesRequest): UpdateDeliveryChargesRequest {
    const sanitized: UpdateDeliveryChargesRequest = {};

    if (data.warehouseAddress !== undefined) {
      sanitized.warehouseAddress = data.warehouseAddress.trim().replace(/[<>]/g, '');
    }
    if (data.warehouseLatitude !== undefined) {
      sanitized.warehouseLatitude = Number(data.warehouseLatitude.toFixed(6));
    }
    if (data.warehouseLongitude !== undefined) {
      sanitized.warehouseLongitude = Number(data.warehouseLongitude.toFixed(6));
    }
    if (data.freeDeliveryUpToKm !== undefined) {
      sanitized.freeDeliveryUpToKm = Math.round(data.freeDeliveryUpToKm * 10) / 10;
    }
    if (data.perKmChargeAfterFree !== undefined) {
      sanitized.perKmChargeAfterFree = Math.round(data.perKmChargeAfterFree * 100) / 100;
    }
    if (data.isActive !== undefined) {
      sanitized.isActive = data.isActive;
    }

    return sanitized;
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3000, panelClass: 'success-snackbar' });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 5000, panelClass: 'error-snackbar' });
  }

  getError(field: keyof UpdateDeliveryChargesRequest): string | undefined {
    return this.formErrors()[field];
  }

  hasError(field: keyof UpdateDeliveryChargesRequest): boolean {
    return !!this.formErrors()[field];
  }

  formatCoordinate(coord: number): string {
    return coord.toFixed(6);
  }
}