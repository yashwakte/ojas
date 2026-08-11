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
import * as L from 'leaflet';

// Default center: Pune, India (business location fallback when no pin/GPS available)
const DEFAULT_LAT = 18.5204;
const DEFAULT_LNG = 73.8567;

@Component({
  selector: 'app-map-picker',
  imports: [MatIconModule],
  templateUrl: './map-picker.html',
  styleUrl: './map-picker.scss',
})
export class MapPicker implements AfterViewInit, OnDestroy {
  @Input() initialLat: number | null = null;
  @Input() initialLng: number | null = null;
  @Output() locationConfirmed = new EventEmitter<{ lat: number; lng: number }>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>;

  readonly locating = signal(false);
  readonly locateError = signal('');
  centerLat = 0;
  centerLng = 0;

  private map: L.Map | null = null;

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

    if (!this.initialLat) {
      this.useCurrentLocation();
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  private updateCenter(): void {
    if (!this.map) return;
    const center = this.map.getCenter();
    this.centerLat = center.lat;
    this.centerLng = center.lng;
  }

  useCurrentLocation(): void {
    if (!navigator.geolocation) {
      this.locateError.set('Location access is not supported on this device.');
      return;
    }

    this.locating.set(true);
    this.locateError.set('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        this.map?.setView([latitude, longitude], 17);
        this.locating.set(false);
      },
      () => {
        this.locateError.set('Could not access your location. Please pin it manually.');
        this.locating.set(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  confirm(): void {
    this.locationConfirmed.emit({ lat: this.centerLat, lng: this.centerLng });
  }

  cancel(): void {
    this.cancelled.emit();
  }
}
