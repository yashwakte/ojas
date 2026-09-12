import { Injectable, signal } from '@angular/core';

/** Where on screen the search was opened from, so it can open out of that spot. */
export interface SearchOrigin {
  x: number;
  y: number;
}

/**
 * Opens and closes the product search overlay from anywhere: the header's search icon, the phone
 * drawer, or the "/" key. There is one overlay (in app.html), so every entry point shows the same
 * thing with the same recent searches.
 */
@Injectable({ providedIn: 'root' })
export class SearchUiService {
  private readonly _open = signal(false);
  private readonly _seed = signal('');
  private readonly _origin = signal<SearchOrigin | null>(null);

  readonly isOpen = this._open.asReadonly();
  /** What the search box holds when it opens. */
  readonly seed = this._seed.asReadonly();
  /** The centre of whatever opened it, or null to open from the header's usual corner. */
  readonly origin = this._origin.asReadonly();

  open(query = '', origin: SearchOrigin | null = null): void {
    this._seed.set(query);
    this._origin.set(origin);
    this._open.set(true);
  }

  close(): void {
    this._open.set(false);
  }
}
