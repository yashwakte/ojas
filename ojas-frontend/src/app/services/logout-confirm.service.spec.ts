import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { LogoutConfirmService } from './logout-confirm.service';
import { AuthService } from './auth.service';
import { ConfirmDialog } from '../components/confirm-dialog/confirm-dialog';

describe('LogoutConfirmService', () => {
  let answer: Subject<boolean | undefined>;
  let dialog: { open: jasmine.Spy };
  let auth: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    answer = new Subject<boolean | undefined>();
    dialog = { open: jasmine.createSpy('open').and.callFake(() => ({ afterClosed: () => answer })) };
    auth = jasmine.createSpyObj('AuthService', ['logout']);

    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialog, useValue: dialog },
        { provide: AuthService, useValue: auth },
      ],
    });
  });

  /** The dialog code is imported on the first tap; wait for the dialog to have been opened. */
  async function dialogsOpened(count: number): Promise<void> {
    for (let i = 0; i < 50 && dialog.open.calls.count() < count; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Lets the answer travel through the service's promise chain. */
  const answered = () => new Promise((r) => setTimeout(r, 0));

  it('asks before signing out, and signs out once confirmed', async () => {
    const service = TestBed.inject(LogoutConfirmService);

    service.request();
    await dialogsOpened(1);

    expect(dialog.open).toHaveBeenCalledWith(ConfirmDialog, jasmine.anything());
    const config = dialog.open.calls.mostRecent().args[1];
    expect(config.data.title).toBe('Log out of Ojas?');
    expect(config.data.confirmLabel).toBe('Log out');
    expect(auth.logout).not.toHaveBeenCalled();

    answer.next(true);
    await answered();
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it('stays signed in when the answer is Cancel', async () => {
    TestBed.inject(LogoutConfirmService).request();
    await dialogsOpened(1);
    answer.next(false);
    await answered();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('stays signed in when the dialog is dismissed with Escape or the backdrop', async () => {
    TestBed.inject(LogoutConfirmService).request();
    await dialogsOpened(1);
    answer.next(undefined);
    await answered();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('does not stack a second dialog on a double tap, and can ask again once answered', async () => {
    const service = TestBed.inject(LogoutConfirmService);

    service.request();
    service.request();
    await dialogsOpened(1);
    await answered();
    expect(dialog.open).toHaveBeenCalledTimes(1);

    answer.next(false);
    await answered();

    service.request();
    await dialogsOpened(2);
    expect(dialog.open).toHaveBeenCalledTimes(2);
  });
});
