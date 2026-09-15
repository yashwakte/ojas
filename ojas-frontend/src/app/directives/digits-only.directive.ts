import { Directive, ElementRef, inject } from '@angular/core';

/**
 * The digits of a mobile number, from whatever was typed or pasted.
 *
 * A pasted number usually carries more than its ten digits - "+91 98765 43210", "098765-43210" -
 * so the country code or trunk 0 is dropped when that is clearly what the extra digits are. Only
 * then: a full number that happens to start with 91 is left alone.
 */
export function toMobileDigits(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/**
 * A mobile-number box that only ever holds digits.
 *
 *   <input type="tel" appDigitsOnly [(ngModel)]="phone" />
 *
 * Opens the number pad on a phone (inputmode, plus a digits pattern for iOS Safari) and cleans
 * the value as it is typed or pasted - spaces, dashes, letters and a +91 prefix all go. The
 * cleaned value is sent on as a fresh input event, so ngModel and reactive forms both end up
 * holding the digits rather than what was pasted. No maxlength goes on these boxes: it would cut
 * a pasted "+91 98765 43210" off before this had a chance to tidy it.
 */
@Directive({
  selector: 'input[appDigitsOnly]',
  host: {
    inputmode: 'numeric',
    pattern: '[0-9]*',
    '(input)': 'clean()',
  },
})
export class DigitsOnlyDirective {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);

  protected clean(): void {
    const input = this.el.nativeElement;
    const digits = toMobileDigits(input.value);
    if (digits === input.value) return;
    input.value = digits;
    // The form may already have read the raw value from this same event; this corrects it. The
    // echo comes straight back here, finds nothing to change, and stops.
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
