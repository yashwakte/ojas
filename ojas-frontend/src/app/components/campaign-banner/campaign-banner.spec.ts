import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CampaignBanner } from './campaign-banner';

@Component({
  imports: [CampaignBanner],
  template: `
    <app-campaign-banner
      [title]="title()"
      [subtitle]="subtitle()"
      [ctaText]="ctaText()"
      [backgroundImageUrl]="image()"
      [priority]="priority()"
    />
  `,
})
class Host {
  title = signal('');
  subtitle = signal('');
  ctaText = signal('Shop Now');
  image = signal('');
  priority = signal(false);
}

describe('CampaignBanner', () => {
  function create() {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  function banner(fixture: ReturnType<typeof create>) {
    return fixture.nativeElement.querySelector('.campaign-banner') as HTMLElement;
  }

  // Both are optional because festival artwork usually carries its own headline; a second one
  // laid over the same picture is what looked wrong on the live Janmashtami banner.
  it('renders no heading or paragraph when title and subtitle are blank', () => {
    const fixture = create();
    fixture.componentInstance.image.set('/api/media/abc.webp');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h2')).toBeNull();
    expect(fixture.nativeElement.querySelector('.campaign-banner-inner p')).toBeNull();
    // The call to action survives on its own - it is the only thing left over the picture.
    expect(fixture.nativeElement.querySelector('.btn-white').textContent).toContain('Shop Now');
  });

  it('renders the heading and paragraph when they are given', () => {
    const fixture = create();
    fixture.componentInstance.title.set('Krishna Janmashthami');
    fixture.componentInstance.subtitle.set('Bring home fresh products');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Krishna Janmashthami');
    expect(fixture.nativeElement.querySelector('.campaign-banner-inner p').textContent).toContain(
      'Bring home fresh products',
    );
  });

  // The scrim is what darkens the artwork so overlaid text stays readable. With no text there
  // is nothing to make readable, and dimming the lower half of a festival photo for the sake of
  // one button spoils the picture - so the class that draws it is withheld.
  it('only marks itself as having overlay text when there is text to protect', () => {
    const fixture = create();
    fixture.componentInstance.image.set('/api/media/abc.webp');
    fixture.detectChanges();
    expect(banner(fixture).classList).not.toContain('has-overlay-text');

    fixture.componentInstance.subtitle.set('Save big');
    fixture.detectChanges();
    expect(banner(fixture).classList).toContain('has-overlay-text');
  });

  it('loads its picture lazily unless it is the priority banner', () => {
    const fixture = create();
    fixture.componentInstance.image.set('/api/media/abc.webp');
    fixture.detectChanges();

    const img = () => fixture.nativeElement.querySelector('.campaign-banner-img') as HTMLImageElement;
    expect(img().getAttribute('loading')).toBe('lazy');
    expect(img().getAttribute('fetchpriority')).toBeNull();
    expect(img().getAttribute('decoding')).toBe('async');

    fixture.componentInstance.priority.set(true);
    fixture.detectChanges();
    expect(img().getAttribute('loading')).toBe('eager');
    expect(img().getAttribute('fetchpriority')).toBe('high');
  });

  it('renders no image element at all when no artwork is set', () => {
    const fixture = create();
    expect(fixture.nativeElement.querySelector('.campaign-banner-media')).toBeNull();
    expect(banner(fixture).classList).not.toContain('has-bg-image');
  });
});
