import { TestBed } from '@angular/core/testing';
import { Offers } from './offers';

describe('Offers', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Offers] });
  });

  it('should create and render the coming-soon message', () => {
    const fixture = TestBed.createComponent(Offers);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Offers & Deals');
    expect(text).toContain('Exciting offers are on the way!');
  });
});
