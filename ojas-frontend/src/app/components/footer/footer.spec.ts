import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Footer } from './footer';
import {
  FSSAI_LICENCE_NUMBER,
  INSTAGRAM_URL,
  REGISTERED_ADDRESS_LINES,
} from '../../constants/business';

describe('Footer', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Footer],
      providers: [provideRouter([])],
    });
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(Footer);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('sets currentYear to the current year', () => {
    const fixture = TestBed.createComponent(Footer);
    fixture.detectChanges();
    expect(fixture.componentInstance.currentYear).toBe(new Date().getFullYear());
  });

  it('renders the current year in the template', () => {
    const fixture = TestBed.createComponent(Footer);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(String(new Date().getFullYear()));
  });

  // The licence number and the registered address are compliance statements, not decoration:
  // a customer and a payment provider's review both look for them here. A silent regression
  // that drops either is the kind of thing nobody notices until the domain review fails.
  it('shows the FSSAI licence number and the full registered address', () => {
    const fixture = TestBed.createComponent(Footer);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(FSSAI_LICENCE_NUMBER);
    for (const line of REGISTERED_ADDRESS_LINES) {
      expect(text).toContain(line.replace(/,$/, ''));
    }
  });

  it('links the Ojas Instagram page', () => {
    const fixture = TestBed.createComponent(Footer);
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      `a[href="${INSTAGRAM_URL}"]`,
    );
    expect(link).toBeTruthy();
    expect(link?.getAttribute('rel')).toContain('noopener');
  });
});
