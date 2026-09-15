import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SiteIntro } from './site-intro';
import { WelcomeService } from '../../services/welcome.service';

describe('SiteIntro (ending the arrival)', () => {
  let welcome: { playIntro: boolean; completeIntro: jasmine.Spy };
  let screen: HTMLElement | null = null;
  let header: HTMLElement | null = null;

  /** The screen as index.html draws it, sized so the glide has real geometry to work with. */
  function addScreen(): void {
    screen = document.createElement('div');
    screen.id = 'ojas-arrival';
    screen.innerHTML =
      '<span class="arrival-ground" style="position:fixed;inset:0"></span>' +
      '<span class="arrival-mark" style="display:block;width:200px;height:87px"></span>' +
      '<span class="arrival-line" style="display:block;width:200px;height:1px"></span>';
    document.body.appendChild(screen);
  }

  function addHeaderLogo(): void {
    header = document.createElement('app-header');
    header.innerHTML = '<img class="logo-img" alt="" style="display:block;width:63px;height:40px" />';
    document.body.appendChild(header);
  }

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function start(playIntro: boolean): Promise<void> {
    welcome = { playIntro, completeIntro: jasmine.createSpy('completeIntro') };
    TestBed.configureTestingModule({
      imports: [SiteIntro],
      providers: [provideRouter([]), { provide: WelcomeService, useValue: welcome }],
    });
    const fixture = TestBed.createComponent(SiteIntro);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
  }

  afterEach(() => {
    screen?.remove();
    header?.remove();
    screen = header = null;
    document.body.classList.remove('intro-locked');
  });

  it('simply fades the screen away on a load that is not the first of the visit', async () => {
    addScreen();
    await start(false);
    await wait(700);

    expect(document.getElementById('ojas-arrival')).toBeNull();
    expect(welcome.completeIntro).not.toHaveBeenCalled();
  });

  it('on the first page of a visit, glides the mark into the header logo and hands the page over', async () => {
    addScreen();
    addHeaderLogo();
    await start(true);
    await wait(1700);

    expect(welcome.completeIntro).toHaveBeenCalledTimes(1);
    expect(document.getElementById('ojas-arrival')).toBeNull();
    // The header's own logo is back, with nothing left overriding it.
    expect((header!.querySelector('.logo-img') as HTMLElement).style.opacity).toBe('');
    expect(document.body.classList).not.toContain('intro-locked');
  });

  it('still ends the screen when there is no header logo to land on', async () => {
    addScreen();
    await start(true);
    await wait(1700);

    expect(welcome.completeIntro).toHaveBeenCalledTimes(1);
    expect(document.getElementById('ojas-arrival')).toBeNull();
  });

  it('hands over at once on a page that has no arrival screen', async () => {
    await start(true);
    await wait(50);

    expect(welcome.completeIntro).toHaveBeenCalledTimes(1);
  });
});
