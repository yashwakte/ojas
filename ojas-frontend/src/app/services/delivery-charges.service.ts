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

  calculateDeliveryCharge(distanceKm: number): { charge: number; isFree: boolean; breakdown: string } {
    const config = this._config();
    if (!config || !config.isActive) {
      return { charge: 0, isFree: true, breakdown: 'Delivery charges not configured' };
    }

    if (distanceKm <= config.freeDeliveryUpToKm) {
      return {
        charge: 0,
        isFree: true,
        breakdown: `Free delivery (within ${config.freeDeliveryUpToKm} km)`,
      };
    }

    const chargeableKm = distanceKm - config.freeDeliveryUpToKm;
    const charge = Math.round(chargeableKm * config.perKmChargeAfterFree);
    return {
      charge,
      isFree: false,
      breakdown: `${config.freeDeliveryUpToKm} km free + ${chargeableKm.toFixed(1)} km × ₹${config.perKmChargeAfterFree}/km = ₹${charge}`,
    };
  }

  clearError(): void {
    this._error.set(null);
  }
}
