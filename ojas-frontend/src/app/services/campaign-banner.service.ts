import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, Observable, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { CampaignBannerConfig, UpdateCampaignBannerRequest } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class CampaignBannerService {
  private readonly apiUrl = `${environment.apiUrl}/campaign-banner`;
  private readonly _config = signal<CampaignBannerConfig | null>(null);
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
    this.http
      .get<CampaignBannerConfig>(this.apiUrl)
      .pipe(catchError(() => of(null)))
      .subscribe((config) => {
        this._config.set(config);
        this._loading.set(false);
      });
  }

  updateConfig(request: UpdateCampaignBannerRequest): Observable<CampaignBannerConfig> {
    return this.http.patch<CampaignBannerConfig>(this.apiUrl, request).pipe(
      tap((config) => {
        this._config.set(config);
        this._error.set(null);
      }),
    );
  }

  clearError(): void {
    this._error.set(null);
  }
}
