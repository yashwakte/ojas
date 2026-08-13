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

  constructor(private http: HttpClient) {
    this.loadCampaigns();
  }

  loadCampaigns(): void {
    this._loading.set(true);
    this._error.set(null);
    this.http
      .get<CampaignBannerConfig[]>(this.apiUrl)
      .pipe(catchError(() => of([])))
      .subscribe((campaigns) => {
        this._campaigns.set(campaigns);
        this._loading.set(false);
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
}
