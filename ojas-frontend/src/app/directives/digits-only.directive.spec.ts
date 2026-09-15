import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DigitsOnlyDirective, toMobileDigits } from './digits-only.directive';

@Component({
  imports: [FormsModule, ReactiveFormsModule, DigitsOnlyDirective],
  template: `
    <input class="model" type="tel" appDigitsOnly [(ngModel)]="phone" />
    <input class="reactive" type="tel" appDigitsOnly [formControl]="control" />
  `,
})
class Host {
  phone = '';
  readonly control = new FormControl('');
}

describe('DigitsOnlyDirective', () => {
  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('asks a phone for its number pad', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.model');

    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('pattern')).toBe('[0-9]*');
  });

  it('keeps only the digits, and the form holds them too', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const model: HTMLInputElement = fixture.nativeElement.querySelector('.model');
    const reactive: HTMLInputElement = fixture.nativeElement.querySelector('.reactive');

    type(model, '98765 abc-43210');
    type(reactive, '+91 98765 43210');

    expect(model.value).toBe('9876543210');
    expect(fixture.componentInstance.phone).toBe('9876543210');
    expect(reactive.value).toBe('9876543210');
    expect(fixture.componentInstance.control.value).toBe('9876543210');
  });

  it('drops a country code or trunk 0, but never the start of a real number', () => {
    expect(toMobileDigits('+91 98765 43210')).toBe('9876543210');
    expect(toMobileDigits('098765-43210')).toBe('9876543210');
    // A number that simply begins with 91, with one digit too many typed: the extra goes.
    expect(toMobileDigits('91234567890')).toBe('9123456789');
    expect(toMobileDigits('9123456789')).toBe('9123456789');
  });
});
