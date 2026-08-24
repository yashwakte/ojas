import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { WalletResponse } from '../models/interfaces';

/** Closed-loop store credit: spendable on Ojas, never withdrawable — which is deliberate, and
 * why there is no withdraw call here to write. */
@Injectable({ providedIn: 'root' })
export class WalletService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/wallet`;

  private readonly _balance = signal(0);
  /** Cached so checkout can show the balance without its own request. */
  readonly balance = this._balance.asReadonly();

  load(): Observable<WalletResponse> {
    return this.http
      .get<WalletResponse>(this.apiUrl)
      .pipe(tap((wallet) => this._balance.set(wallet.balance)));
  }
}
