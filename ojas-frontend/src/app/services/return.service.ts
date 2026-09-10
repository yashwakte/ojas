import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CreateReturnRequest,
  ReturnEligibility,
  ReturnRequestResponse,
  ReturnSettlementResponse,
  UpdateReturnStatusRequest,
} from '../models/interfaces';

/**
 * Returns, for both audiences.
 *
 * The customer's list and the admin queue are separate signals rather than one filtered list:
 * they come from different endpoints with different shapes — the queue carries the customer's
 * name, phone and pickup address, and a customer's own read deliberately does not — and blending
 * them would make it possible to render one audience's data in the other's screen.
 *
 * Every mutating call hands back the updated request and this service swaps it in whole, rather
 * than patching a status onto the copy it already holds. Settling a return moves more than its
 * status: the refund splits, the queued balance and the event timeline all change at once, and
 * patching one field is exactly what once left cancelled orders still offering to take payment.
 */
@Injectable({ providedIn: 'root' })
export class ReturnService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/returns`;

  private readonly _mine = signal<ReturnRequestResponse[]>([]);
  private readonly _queue = signal<ReturnRequestResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly mine = this._mine.asReadonly();
  readonly queue = this._queue.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** What the admin dashboard's tab badge counts: everything still waiting on a human. A return
   * nobody can see is a return nobody actions. */
  readonly openQueueCount = computed(
    () =>
      this._queue().filter(
        (r) => r.status === 'Requested' || r.status === 'Approved' || r.status === 'PickedUp',
      ).length,
  );

  /** Every return this customer has raised, newest first. */
  loadMine(): void {
    this._loading.set(true);
    this.http.get<ReturnRequestResponse[]>(`${this.apiUrl}/my`).subscribe({
      next: (returns) => {
        this._mine.set(returns);
        this._loading.set(false);
      },
      error: () => {
        // Deliberately quiet: a customer whose returns list fails to load still has an orders
        // page that works, and an error banner over it would say nothing they can act on.
        this._mine.set([]);
        this._loading.set(false);
      },
    });
  }

  /** What can still be sent back from one order. Asked before the sheet opens, so what the
   * customer is offered is what the API will accept. */
  eligibility(orderId: string): Observable<ReturnEligibility> {
    return this.http.get<ReturnEligibility>(`${this.apiUrl}/eligibility/${orderId}`);
  }

  create(request: CreateReturnRequest): Observable<ReturnRequestResponse> {
    return this.http
      .post<ReturnRequestResponse>(`${this.apiUrl}/my`, request)
      .pipe(tap((created) => this._mine.update((all) => [created, ...all])));
  }

  cancel(id: string): Observable<ReturnRequestResponse> {
    return this.http
      .patch<ReturnRequestResponse>(`${this.apiUrl}/my/${id}/cancel`, {})
      .pipe(tap((updated) => this.replaceMine(updated)));
  }

  // ===== ADMIN =====

  loadQueue(): void {
    this._loading.set(true);
    this._error.set(null);
    this.http.get<ReturnRequestResponse[]>(`${this.apiUrl}/admin/all`).subscribe({
      next: (returns) => {
        this._queue.set(returns);
        this._loading.set(false);
      },
      error: () => {
        this._error.set('Failed to load returns');
        this._loading.set(false);
      },
    });
  }

  updateStatus(id: string, request: UpdateReturnStatusRequest): Observable<ReturnSettlementResponse> {
    return this.http
      .patch<ReturnSettlementResponse>(`${this.apiUrl}/admin/${id}/status`, request)
      .pipe(
        tap((settlement) => {
          if (settlement.request) this.replaceInQueue(settlement.request);
        }),
      );
  }

  private replaceMine(updated: ReturnRequestResponse): void {
    this._mine.update((all) => all.map((r) => (r.id === updated.id ? updated : r)));
  }

  private replaceInQueue(updated: ReturnRequestResponse): void {
    this._queue.update((all) => all.map((r) => (r.id === updated.id ? updated : r)));
  }
}
