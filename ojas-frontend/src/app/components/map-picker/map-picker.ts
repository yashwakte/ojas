import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import * as L from 'leaflet';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { GeoResult, GeocodingService } from '../../services/geocoding.service';

// Default center: Pune, India (business location fallback when no pin/GPS available)
const DEFAULT_LAT = 18.5204;
const DEFAULT_LNG = 73.8567;

/** Above this, a GPS fix is too vague to trust as a doorstep — ask them to nudge it. */
const POOR_ACCURACY_M = 100;

@Component({
  selector: 'app-map-picker',
  imports: [MatIconModule, FormsModule],
  templateUrl: './map-picker.html',
  styleUrl: './map-picker.scss',
})
export class MapPicker implements AfterViewInit, OnDestroy {
  @Input() initialLat: number | null = null;
  @Input() initialLng: number | null = null;
  @Input() instructionText = 'Drag the map so the pin points to your exact delivery location.';
  @Input() confirmLabel = 'Confirm Pinned Location';
  /**
   * Opt-in: hold the pin to the serviceable delivery area. Off by default so the
   * admin can still place the warehouse itself anywhere.
   */
  @Input() enforceServiceArea = false;
  /** `address` is the reverse-geocoded label for the pin, when one resolved. */
  @Output() locationConfirmed = new EventEmitter<{ lat: number; lng: number; address?: string }>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>;

  readonly locating = signal(false);
  readonly locateError = signal('');
  readonly outsideServiceArea = signal(false);
  readonly distanceFromStoreKm = signal<number | null>(null);
  readonly serviceRadiusKm = signal(0);
  readonly accuracyWarning = signal('');

  readonly searchResults = signal<GeoResult[]>([]);
  readonly searching = signal(false);
  readonly resolvedAddress = signal('');
  searchQuery = '';

  centerLat = 0;
  centerLng = 0;

  private map: L.Map | null = null;
  private serviceAreaCircle: L.Circle | null = null;
  private accuracyCircle: L.Circle | null = null;
  private readonly searchInput = new Subject<string>();
  private readonly centerSettled = new Subject<{ lat: number; lng: number }>();

  constructor(
    private deliveryCharges: DeliveryChargesService,
    private geocoding: GeocodingService,
  ) {
    this.searchInput
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => this.geocoding.search(q)),
        takeUntilDestroyed(),
      )
      .subscribe((results) => {
        this.searchResults.set(results);
        this.searching.set(false);
      });

    // Only reverse-geocode once the map stops moving, not on every frame.
    this.centerSettled
      .pipe(
        debounceTime(500),
        distinctUntilChanged((a, b) => a.lat === b.lat && a.lng === b.lng),
        switchMap(({ lat, lng }) => this.geocoding.reverse(lat, lng)),
        takeUntilDestroyed(),
      )
      .subscribe((address) => this.resolvedAddress.set(address ?? ''));
  }

  onSearchInput(): void {
    const q = this.searchQuery.trim();
    this.searching.set(q.length >= 3);
    if (q.length < 3) this.searchResults.set([]);
    this.searchInput.next(q);
  }

  chooseResult(result: GeoResult): void {
    this.map?.setView([result.lat, result.lng], 17);
    this.searchResults.set([]);
    this.searchQuery = result.label;
    this.accuracyWarning.set('');
    this.clearAccuracyCircle();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults.set([]);
  }

  ngAfterViewInit(): void {
    const startLat = this.initialLat ?? DEFAULT_LAT;
    const startLng = this.initialLng ?? DEFAULT_LNG;
    this.centerLat = startLat;
    this.centerLng = startLng;

    this.map = L.map(this.mapContainer.nativeElement, {
      center: [startLat, startLng],
      zoom: this.initialLat ? 17 : 13,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    this.map.on('move', () => this.updateCenter());
    this.map.on('moveend', () => this.updateCenter());

    // Fix tile rendering glitch when map is created inside a freshly opened panel
    setTimeout(() => this.map?.invalidateSize(), 100);

    this.drawServiceArea();
    this.evaluateServiceArea();

    if (!this.initialLat) {
      this.useCurrentLocation();
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
    this.serviceAreaCircle = null;
    this.accuracyCircle = null;
  }

  private updateCenter(): void {
    if (!this.map) return;
    const center = this.map.getCenter();
    this.centerLat = center.lat;
    this.centerLng = center.lng;
    this.evaluateServiceArea();
    this.centerSettled.next({ lat: center.lat, lng: center.lng });
  }

  /** Shade the deliverable radius so the limit is visible, not just enforced. */
  private drawServiceArea(): void {
    if (!this.enforceServiceArea || !this.map) return;
    const cfg = this.deliveryCharges.config();
    if (!cfg?.isActive || !cfg.maxDeliveryRadiusKm) return;

    this.serviceAreaCircle = L.circle([cfg.warehouseLatitude, cfg.warehouseLongitude], {
      radius: cfg.maxDeliveryRadiusKm * 1000,
      color: '#f25a1a',
      weight: 1.5,
      fillColor: '#f25a1a',
      fillOpacity: 0.06,
      interactive: false,
    }).addTo(this.map);
  }

  private evaluateServiceArea(): void {
    if (!this.enforceServiceArea) return;

    const cfg = this.deliveryCharges.config();
    if (!cfg?.isActive || !cfg.maxDeliveryRadiusKm) {
      this.outsideServiceArea.set(false);
      return;
    }

    const distance = haversineKm(
      cfg.warehouseLatitude,
      cfg.warehouseLongitude,
      this.centerLat,
      this.centerLng,
    );
    this.serviceRadiusKm.set(cfg.maxDeliveryRadiusKm);
    this.distanceFromStoreKm.set(distance);
    this.outsideServiceArea.set(distance > cfg.maxDeliveryRadiusKm);
  }

  useCurrentLocation(): void {
    if (!navigator.geolocation) {
      this.locateError.set('Location access is not supported on this device.');
      return;
    }

    this.locating.set(true);
    this.locateError.set('');
    this.accuracyWarning.set('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        // Zoom to match the fix: a vague fix zoomed in tight looks precise and isn't.
        const zoom = accuracy <= 50 ? 18 : accuracy <= 200 ? 16 : 14;
        this.map?.setView([latitude, longitude], zoom);
        this.showAccuracyCircle(latitude, longitude, accuracy);

        if (accuracy > POOR_ACCURACY_M) {
          this.accuracyWarning.set(
            `Your device placed you within about ${Math.round(accuracy)} m. Drag the map to your exact door.`,
          );
        }
        this.locating.set(false);
      },
      (err) => {
        this.locateError.set(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Search for your area or pin it manually.'
            : 'Could not get an accurate fix. Search for your area or pin it manually.',
        );
        this.locating.set(false);
      },
      // maximumAge: 0 forces a fresh fix — a cached one is the usual cause of
      // the map landing somewhere the user was hours ago.
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  /** Draws the GPS uncertainty so the fix's vagueness is visible, not implied. */
  private showAccuracyCircle(lat: number, lng: number, accuracy: number): void {
    if (!this.map) return;
    this.clearAccuracyCircle();
    this.accuracyCircle = L.circle([lat, lng], {
      radius: accuracy,
      color: '#2563eb',
      weight: 1,
      fillColor: '#2563eb',
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(this.map);
  }

  private clearAccuracyCircle(): void {
    if (this.accuracyCircle && this.map) {
      this.map.removeLayer(this.accuracyCircle);
    }
    this.accuracyCircle = null;
  }

  confirm(): void {
    if (this.outsideServiceArea()) return;
    this.locationConfirmed.emit({
      lat: this.centerLat,
      lng: this.centerLng,
      address: this.resolvedAddress() || undefined,
    });
  }

  cancel(): void {
    this.cancelled.emit();
  }
}

// Haversine great-circle distance in km — mirrors the server's own calculation
// so the live warning agrees with the decision the API will ultimately make.
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
