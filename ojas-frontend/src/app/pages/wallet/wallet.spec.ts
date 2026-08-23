import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Wallet } from './wallet';
import { WalletService } from '../../services/wallet.service';
import { walletReasonLabel } from '../../models/interfaces';

describe('Wallet', () => {
  let walletServiceSpy: jasmine.SpyObj<WalletService>;

  beforeEach(() => {
    walletServiceSpy = jasmine.createSpyObj('WalletService', ['load']);
    TestBed.configureTestingModule({
      imports: [Wallet],
      providers: [provideRouter([]), { provide: WalletService, useValue: walletServiceSpy }],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(Wallet);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the balance and statement once loaded', () => {
    walletServiceSpy.load.and.returnValue(
      of({
        balance: 200,
        transactions: [
          {
            amount: 200,
            balanceAfter: 200,
            reason: 'OrderEditRefund',
            orderId: 'o1',
            createdAt: '2026-08-22T00:00:00Z',
          },
        ],
      }),
    );

    const fixture = create();

    expect(fixture.componentInstance.balance()).toBe(200);
    expect(fixture.componentInstance.transactions().length).toBe(1);
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('reports a failure rather than showing a misleading zero balance', () => {
    walletServiceSpy.load.and.returnValue(throwError(() => new Error('fail')));

    const fixture = create();

    expect(fixture.componentInstance.error()).toContain("Couldn't load");
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('renders ledger reason codes as something a customer would recognise', () => {
    expect(walletReasonLabel('OrderEditRefund')).toBe('Refund from changing an order');
    expect(walletReasonLabel('OrderPayment')).toBe('Paid towards an order');
    expect(walletReasonLabel('WalletPortionReturned')).toBe(
      'Wallet amount returned from a cancelled order',
    );
    // An unknown code falls back to itself rather than rendering blank.
    expect(walletReasonLabel('SomethingNew')).toBe('SomethingNew');
  });
});
