import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  icon?: string;
  /** Danger paints the confirm button red: for actions that end or remove something. */
  tone?: 'danger' | 'default';
}

/** Ids the dialog config points aria-labelledby / aria-describedby at. */
export const CONFIRM_DIALOG_TITLE_ID = 'confirm-dialog-title';
export const CONFIRM_DIALOG_MESSAGE_ID = 'confirm-dialog-message';

/**
 * A two-button "are you sure?" dialog. Closes with `true` for confirm and `false` for cancel;
 * Escape and a click on the backdrop close it with `undefined`, which callers treat as no.
 *
 * Cancel is focused first on purpose. Somebody who opened this by accident and presses Enter to
 * get rid of it must not be carried through the thing they were being asked about.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatIconModule],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ConfirmDialog, boolean>>(MatDialogRef);

  readonly titleId = CONFIRM_DIALOG_TITLE_ID;
  readonly messageId = CONFIRM_DIALOG_MESSAGE_ID;

  confirm(): void {
    this.ref.close(true);
  }

  cancel(): void {
    this.ref.close(false);
  }
}
