import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  DeliveryChargeCalculation,
  DeliveryChargesConfig,
  UpdateDeliveryChargesRequest,
} from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class DeliveryChargesService {
  private readonly apiUrl = `${environment.apiUrl}/delivery-charges`;
  private readonly _config = signal<DeliveryChargesConfig | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly config = this._config.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor(private http: HttpClient) {
    this.loadConfig();
  }

  loadConfig(): void {
    this._loading.set(true);
    this._error.set(null);
    this.http.get<DeliveryChargesConfig>(this.apiUrl).subscribe({
      next: (config) => {
        this._config.set(config);
        this._loading.set(false);
      },
      error: () => {
        this._error.set('Failed to load delivery charges');
        this._loading.set(false);
      },
    });
  }

  updateConfig(request: UpdateDeliveryChargesRequest): Observable<DeliveryChargesConfig> {
    return this.http.patch<DeliveryChargesConfig>(this.apiUrl, request).pipe(
      tap((config) => {
        // Keep the displayed configuration in sync with the successful upsert response.
        this._config.set(config);
        this._error.set(null);
      }),
    );
  }

  /** Server-computed charge for a real delivery location (used at checkout — always trust this over any client-side estimate). */
  previewCharge(latitude: number, longitude: number): Observable<DeliveryChargeCalculation> {
    return this.http.get<DeliveryChargeCalculation>(`${this.apiUrl}/calculate`, {
      params: { latitude, longitude },
    });
  }

  /** Whether a location is inside the serviceable radius, per the saved config. */
  isWithinServiceArea(distanceKm: number): boolean {
    const max = this._config()?.maxDeliveryRadiusKm ?? 0;
    return max <= 0 || distanceKm <= max;
  }

  calculateDeliveryCharge(
    distanceKm: number,
    // Defaults to the saved config, but callers previewing unsaved edits (e.g. the
    // admin's "Test Distance Calculation" tool) can pass the in-progress form values
    // instead so the preview reflects what they just typed, not the last saved rules.
    // The radius is optional here: callers that only care about the charge math
    // can omit it, and an absent radius means "no limit", same as 0.
    config:
      | (Pick<DeliveryChargesConfig, 'freeDeliveryUpToKm' | 'perKmChargeAfterFree' | 'isActive'> &
          Partial<Pick<DeliveryChargesConfig, 'maxDeliveryRadiusKm'>>)
      | null = this._config(),
  ): { charge: number; isFree: boolean; breakdown: string; isServiceable: boolean } {
    if (!config || !config.isActive) {
      return {
        charge: 0,
        isFree: true,
        isServiceable: true,
        breakdown: 'Delivery charges not configured',
      };
    }

    const maxRadius = config.maxDeliveryRadiusKm ?? 0;
    if (maxRadius > 0 && distanceKm > maxRadius) {
      return {
        charge: 0,
        isFree: false,
        isServiceable: false,
        breakdown: `Outside the ${maxRadius} km delivery area (${distanceKm.toFixed(1)} km away)`,
      };
    }

    if (distanceKm <= config.freeDeliveryUpToKm) {
      return {
        charge: 0,
        isFree: true,
        isServiceable: true,
        breakdown: `Free delivery (within ${config.freeDeliveryUpToKm} km)`,
      };
    }

    const chargeableKm = distanceKm - config.freeDeliveryUpToKm;
    const charge = Math.round(chargeableKm * config.perKmChargeAfterFree);
    return {
      charge,
      isFree: false,
      isServiceable: true,
      breakdown: `${config.freeDeliveryUpToKm} km free + ${chargeableKm.toFixed(1)} km × ₹${config.perKmChargeAfterFree}/km = ₹${charge}`,
    };
  }

  clearError(): void {
    this._error.set(null);
  }
}
