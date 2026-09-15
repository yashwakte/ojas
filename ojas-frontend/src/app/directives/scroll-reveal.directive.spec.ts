import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ScrollRevealDirective } from './scroll-reveal.directive';

@Component({
  imports: [ScrollRevealDirective],
  template: `
    <p class="late" [appScrollReveal]="120">Rises in late</p>
    <div class="bare" appScrollReveal>Rises in</div>
    <div class="row" appScrollReveal revealVariant="row">
      <span>a</span><span>b</span><span>c</span>
    </div>
  `,
})
class Host {}

describe('ScrollRevealDirective', () => {
  function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, el };
  }

  it('carries its delay as a custom property, and a bare attribute means none', () => {
    const { el } = create();

    expect(el.querySelector<HTMLElement>('.late')!.style.getPropertyValue('--reveal-delay')).toBe('120ms');
    expect(el.querySelector<HTMLElement>('.bare')!.style.getPropertyValue('--reveal-delay')).toBe('0ms');
  });

  it('names its variant, and marks the ones that animate their children', () => {
    const { el } = create();

    expect(el.querySelector('.bare')!.getAttribute('data-reveal')).toBe('up');
    expect(el.querySelector('.bare')!.classList).not.toContain('reveal-group');
    expect(el.querySelector('.row')!.getAttribute('data-reveal')).toBe('row');
    expect(el.querySelector('.row')!.classList).toContain('reveal-group');
  });

  it('reveals once on screen, numbering a group’s children for the stagger', async () => {
    const { fixture, el } = create();

    await new Promise((resolve) => setTimeout(resolve, 150));
    fixture.detectChanges();

    const row = el.querySelector<HTMLElement>('.row')!;
    expect(row.classList).toContain('reveal-visible');
    const children = Array.from(row.children) as HTMLElement[];
    expect(children.map((c) => c.style.getPropertyValue('--reveal-i'))).toEqual(['0', '1', '2']);
  });
});
