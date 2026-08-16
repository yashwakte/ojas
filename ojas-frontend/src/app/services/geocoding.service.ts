import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';

export interface GeoResult {
  label: string;
  lat: number;
  lng: number;
}

/** Pune, used to bias results toward the area we actually serve. */
const BIAS_LAT = 18.5204;
const BIAS_LNG = 73.8567;

interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  city?: string;
  county?: string;
  state?: string;
  postcode?: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: PhotonProps;
}

/**
 * Address lookup for the map picker.
 *
 * Backed by Photon (free, keyless, autocomplete-friendly — unlike Nominatim,
 * whose usage policy forbids per-keystroke querying). Everything the app needs
 * is behind `search`/`reverse`, so moving to Google Places later means
 * reimplementing this one file and nothing else.
 */
@Injectable({ providedIn: 'root' })
export class GeocodingService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'https://photon.komoot.io';

  search(query: string): Observable<GeoResult[]> {
    const q = query.trim();
    if (q.length < 3) return of([]);

    return this.http
      .get<{ features: PhotonFeature[] }>(`${this.baseUrl}/api`, {
        params: { q, limit: 6, lat: BIAS_LAT, lon: BIAS_LNG, lang: 'en' },
      })
      .pipe(
        map((res) => (res.features ?? []).map(toResult)),
        catchError(() => of([])),
      );
  }

  /** Turns a pinned point back into a human-readable address. */
  reverse(lat: number, lng: number): Observable<string | null> {
    return this.http
      .get<{ features: PhotonFeature[] }>(`${this.baseUrl}/reverse`, {
        params: { lat, lon: lng, lang: 'en' },
      })
      .pipe(
        map((res) => {
          const feature = res.features?.[0];
          return feature ? toResult(feature).label : null;
        }),
        catchError(() => of(null)),
      );
  }
}

function toResult(feature: PhotonFeature): GeoResult {
  const [lng, lat] = feature.geometry.coordinates;
  const p = feature.properties;

  const parts = [
    [p.housenumber, p.street].filter(Boolean).join(' ') || p.name,
    p.district,
    p.city ?? p.county,
    p.state,
    p.postcode,
  ].filter((part): part is string => !!part);

  // Photon repeats the name inside district/city often enough to be worth de-duping.
  const unique = parts.filter((part, i) => parts.indexOf(part) === i);

  return { label: unique.join(', '), lat, lng };
}
