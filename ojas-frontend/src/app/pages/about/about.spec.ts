import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { About } from './about';
import { FSSAI_LICENCE_NUMBER } from '../../constants/business';

describe('About', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [About], providers: [provideRouter([])] });
  });

  it('should create and render the story content', () => {
    const fixture = TestBed.createComponent(About);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('About Ojas');
    expect(text).toContain('Our Values');
  });

  // The three figures the owner asked to lead with. They are claims about the business, so they
  // are asserted rather than left to drift as someone reworks the stats grid.
  it('states the ten years, fifty products and 1,200 outlets', () => {
    const fixture = TestBed.createComponent(About);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('10+');
    expect(text).toContain('50+');
    expect(text).toContain('1,200+');
    expect(text).toContain('Retail Outlets');
  });

  it('shows the FSSAI licence number', () => {
    const fixture = TestBed.createComponent(About);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(FSSAI_LICENCE_NUMBER);
  });
});
