import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, Observable, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { CampaignBannerConfig, UpdateCampaignBannerRequest } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class CampaignBannerService {
  private readonly apiUrl = `${environment.apiUrl}/campaign-banner`;
  private readonly _campaigns = signal<CampaignBannerConfig[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly campaigns = this._campaigns.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** How long a tab may go without re-checking for new banners when it comes back into view. */
  static readonly REFRESH_AFTER_MS = 60_000;
  private lastLoadedAt = 0;
  private bypassCache = false;

  constructor(private http: HttpClient) {
    this.loadCampaigns();

    // The list is fetched once per tab, and a storefront tab is routinely left open for hours —
    // so a banner the owner published at noon never appeared in a tab opened that morning until
    // somebody reloaded it. Coming back to the tab re-checks, at most once a minute. The answer
    // comes from the CDN edge, so this costs the API nothing.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.refreshIfStale();
      });
    }
  }

  /**
   * `bypassCache` is for the admin console, as it already was for products and hero slides: the
   * edge may hold the list for up to a minute, which is too long for the admin checking the banner
   * they have just saved. A one-off query parameter is a different cache key, so no stored copy
   * can answer it. Remembered, so the tab-return re-check keeps going round the cache for them.
   */
  loadCampaigns(options?: { bypassCache?: boolean }): void {
    this._loading.set(true);
    this._error.set(null);
    this.bypassCache = options?.bypassCache ?? false;
    this.http
      .get<CampaignBannerConfig[]>(this.apiUrl, { params: this.cacheParams() })
      .pipe(catchError(() => of([])))
      .subscribe((campaigns) => {
        this._campaigns.set(campaigns);
        this._loading.set(false);
        this.lastLoadedAt = Date.now();
      });
  }

  /**
   * Re-checks for new banners without disturbing the ones on screen: no loading state, and a
   * failed check keeps what is showing rather than blanking the home page.
   */
  refreshIfStale(now = Date.now()): void {
    if (this._loading() || now - this.lastLoadedAt < CampaignBannerService.REFRESH_AFTER_MS) return;
    this.lastLoadedAt = now;
    this.http.get<CampaignBannerConfig[]>(this.apiUrl, { params: this.cacheParams() }).subscribe({
      next: (campaigns) => {
        // Only swap when something changed, so an unchanged list does not re-render the banners.
        if (JSON.stringify(campaigns) !== JSON.stringify(this._campaigns())) {
          this._campaigns.set(campaigns);
        }
      },
      error: () => {},
    });
  }

  createCampaign(request: UpdateCampaignBannerRequest): Observable<CampaignBannerConfig> {
    return this.http.post<CampaignBannerConfig>(this.apiUrl, request).pipe(
      tap((campaign) => {
        this._campaigns.update((campaigns) => [...campaigns, campaign]);
        this._error.set(null);
      }),
    );
  }

  updateCampaign(id: string, request: UpdateCampaignBannerRequest): Observable<CampaignBannerConfig> {
    return this.http.patch<CampaignBannerConfig>(`${this.apiUrl}/${id}`, request).pipe(
      tap((campaign) => {
        this._campaigns.update((campaigns) => campaigns.map((c) => (c.id === id ? campaign : c)));
        this._error.set(null);
      }),
    );
  }

  deleteCampaign(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`).pipe(
      tap(() => {
        this._campaigns.update((campaigns) => campaigns.filter((c) => c.id !== id));
        this._error.set(null);
      }),
    );
  }

  clearError(): void {
    this._error.set(null);
  }

  private cacheParams(): { _: number } | undefined {
    return this.bypassCache ? { _: Date.now() } : undefined;
  }
}
