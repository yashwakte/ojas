import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RevealWordsDirective } from './reveal-words.directive';

@Component({
  imports: [RevealWordsDirective],
  template: `<h2 [appRevealWords]="text()" [revealDelay]="120"></h2>`,
})
class Host {
  readonly text = signal('Ready to taste the *purity?*');
}

describe('RevealWordsDirective', () => {
  function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const heading: HTMLElement = fixture.nativeElement.querySelector('h2');
    return { fixture, heading };
  }

  it('splits the text into masked words that still read as one sentence', () => {
    const { heading } = create();

    expect(heading.querySelectorAll('.rw').length).toBe(5);
    expect(heading.textContent).toBe('Ready to taste the purity?');
  });

  it('marks the starred word as the accent', () => {
    const { heading } = create();

    const accents = heading.querySelectorAll('.rw-accent');
    expect(accents.length).toBe(1);
    expect(accents[0].textContent).toBe('purity?');
  });

  it('gives assistive technology the sentence once, not word by word', () => {
    const { heading } = create();

    expect(heading.getAttribute('aria-label')).toBe('Ready to taste the purity?');
    heading.querySelectorAll('.rw').forEach((mask) => expect(mask.getAttribute('aria-hidden')).toBe('true'));
  });

  it('staggers the words and carries the delay', () => {
    const { heading } = create();

    const words = heading.querySelectorAll<HTMLElement>('.rw-i');
    expect(words[0].style.getPropertyValue('--rw-i')).toBe('0');
    expect(words[4].style.getPropertyValue('--rw-i')).toBe('4');
    expect(heading.style.getPropertyValue('--rw-delay')).toBe('120ms');
  });

  it('splits again when the text changes', () => {
    const { fixture, heading } = create();

    fixture.componentInstance.text.set('Loved by *Families*');
    fixture.detectChanges();

    expect(heading.querySelectorAll('.rw').length).toBe(3);
    expect(heading.textContent).toBe('Loved by Families');
  });

  it('plays once the heading is on screen', async () => {
    const { fixture, heading } = create();

    // The observer reports asynchronously; the heading is in the test page's viewport.
    await new Promise((resolve) => setTimeout(resolve, 150));
    fixture.detectChanges();

    expect(heading.classList).toContain('rw-in');
  });
});
