import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { About } from './about';

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
});
