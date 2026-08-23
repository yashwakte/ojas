import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { WalletService } from '../../services/wallet.service';
import { WalletTransactionResponse, walletReasonLabel } from '../../models/interfaces';

@Component({
  selector: 'app-wallet',
  imports: [RouterLink, CurrencyPipe, DatePipe, MatIconModule],
  templateUrl: './wallet.html',
  styleUrl: './wallet.scss',
})
export class Wallet implements OnInit {
  private readonly walletService = inject(WalletService);

  balance = signal(0);
  transactions = signal<WalletTransactionResponse[]>([]);
  loading = signal(true);
  error = signal('');

  readonly reasonLabel = walletReasonLabel;

  ngOnInit(): void {
    this.walletService.load().subscribe({
      next: (wallet) => {
        this.balance.set(wallet.balance);
        this.transactions.set(wallet.transactions);
        this.loading.set(false);
      },
      error: () => {
        this.error.set("Couldn't load your wallet.");
        this.loading.set(false);
      },
    });
  }
}
