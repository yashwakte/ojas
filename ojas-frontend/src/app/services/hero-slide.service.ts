import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, Observable, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { HeroSlideConfig, UpdateHeroSlideRequest } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class HeroSlideService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/hero-slides`;

  private readonly _slides = signal<HeroSlideConfig[]>([]);
  private readonly _loading = signal(false);
  /**
   * False until the first response has landed either way.
   *
   * The hero reads this rather than `loading`, and the distinction matters: it is the largest
   * thing in the first screenful, so it paints its shipped artwork immediately and only swaps
   * to the owner's slides once we actually know what they are. Without this flag an empty
   * `slides()` during the request is indistinguishable from an empty `slides()` afterwards, and
   * the hero would flash the built-in poster and then jump.
   */
  private readonly _loaded = signal(false);

  readonly slides = this._slides.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  constructor() {
    this.loadSlides();
  }

  /**
   * Loads the slides into the shared signal.
   *
   * `bypassCache` is for the admin console, and it is not optional there.
   *
   * This service fetches on construction, at app boot, ANONYMOUSLY - the storefront hero injects
   * it long before anybody signs in. That response is stored `public, max-age=300,
   * stale-while-revalidate=3600`. So when an admin later opens the Hero Images tab and this runs
   * again, the browser answers it out of its own HTTP cache and the origin is never asked at all
   * - which means the `no-store` the API sends admins never gets a chance to apply, because that
   * header only governs responses the origin is actually asked for.
   *
   * The symptom is that an admin adds a slide, sees it appear (the POST response is swapped in
   * locally), and then watches it vanish the moment anything re-reads the list - leaving nothing
   * to edit or delete. With stale-while-revalidate on top it keeps vanishing for an hour.
   *
   * A one-off query parameter is a different cache key, so no stored copy at any layer can
   * answer it. Deliberately NOT the default: customers are the traffic this cache exists for,
   * and a storefront hero that is five minutes stale is the cache doing its job.
   */
  loadSlides(options?: { bypassCache?: boolean }): void {
    this._loading.set(true);
    const params = options?.bypassCache ? { _: Date.now() } : undefined;
    this.http
      .get<HeroSlideConfig[]>(this.apiUrl, { params })
      // A hero that cannot reach the API still has to show something, and it does: the caller
      // falls back to the shipped artwork when this list is empty.
      .pipe(catchError(() => of([])))
      .subscribe((slides) => {
        this._slides.set(slides);
        this._loading.set(false);
        this._loaded.set(true);
      });
  }

  createSlide(request: UpdateHeroSlideRequest): Observable<HeroSlideConfig> {
    return this.http
      .post<HeroSlideConfig>(this.apiUrl, request)
      .pipe(tap((slide) => this._slides.update((all) => this.sorted([...all, slide]))));
  }

  updateSlide(id: string, request: UpdateHeroSlideRequest): Observable<HeroSlideConfig> {
    return this.http
      .patch<HeroSlideConfig>(`${this.apiUrl}/${id}`, request)
      .pipe(
        tap((slide) =>
          this._slides.update((all) => this.sorted(all.map((s) => (s.id === id ? slide : s)))),
        ),
      );
  }

  deleteSlide(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/${id}`)
      .pipe(tap(() => this._slides.update((all) => all.filter((s) => s.id !== id))));
  }

  /**
   * Re-sorts locally on the same rule the API sorts on, so an admin who changes a slide's
   * position sees it move at once rather than after a reload.
   */
  private sorted(slides: HeroSlideConfig[]): HeroSlideConfig[] {
    return [...slides].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
    );
  }
}
