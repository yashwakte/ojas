import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { HeroSlideManagement } from './hero-slide-management';
import { HeroSlideService } from '../../services/hero-slide.service';
import { MediaUploadService, UploadedImage } from '../../services/media-upload.service';
import { HeroSlideConfig, UpdateHeroSlideRequest } from '../../models/interfaces';

function slide(overrides: Partial<HeroSlideConfig> = {}): HeroSlideConfig {
  return {
    id: 's1',
    imageUrl: '/media/poster.webp',
    altText: 'The fasting range',
    linkUrl: '',
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    ...overrides,
  };
}

describe('HeroSlideManagement', () => {
  let slides: ReturnType<typeof signal<HeroSlideConfig[]>>;
  let service: jasmine.SpyObj<HeroSlideService>;
  let media: jasmine.SpyObj<MediaUploadService>;
  let snackBar: MatSnackBar;

  function setup() {
    slides = signal<HeroSlideConfig[]>([]);

    service = jasmine.createSpyObj<HeroSlideService>(
      'HeroSlideService',
      ['loadSlides', 'createSlide', 'updateSlide', 'deleteSlide'],
      { slides: slides.asReadonly(), loading: signal(false).asReadonly() },
    );
    service.createSlide.and.returnValue(of(slide()));
    service.updateSlide.and.returnValue(of(slide()));
    service.deleteSlide.and.returnValue(of(undefined));

    media = jasmine.createSpyObj<MediaUploadService>('MediaUploadService', ['validate', 'upload', 'uploadPrepared']);
    media.validate.and.returnValue(null);

    TestBed.configureTestingModule({
      imports: [HeroSlideManagement],
      providers: [
        { provide: HeroSlideService, useValue: service },
        { provide: MediaUploadService, useValue: media },
      ],
    });

    // MatSnackBarModule declares its own `providers: [MatSnackBar]`, which the standalone
    // component pulls into its own injector and which shadows a TestBed-level override - so the
    // real instance is fetched and spied on rather than replaced. Same treatment as
    // campaign-banner-management.spec.ts, which hit this first.
    const fixture = TestBed.createComponent(HeroSlideManagement);
    snackBar = fixture.debugElement.injector.get(MatSnackBar);
    spyOn(snackBar, 'open').and.stub();
    return fixture.componentInstance;
  }

  it('reads the list past the cache, so it cannot open showing a pre-save copy', () => {
    const page = setup();
    page.ngOnInit();

    // The service fetches anonymously at app boot and that response is publicly cacheable, so an
    // admin's read has to carry a distinct cache key or the origin is never asked and a slide
    // they just added is missing from the list - with nothing to edit or delete.
    expect(service.loadSlides).toHaveBeenCalledWith({ bypassCache: true });
  });

  // ---------------------------------------------------------------------------------------
  // WHERE THE PAGE ENDS UP.
  //
  // The list and the form are two branches of one @if, and swapping between them does not reset
  // the scroll offset - so an admin who saves at the bottom of the form is left at the footer
  // with their own change off-screen above them. Every transition here has to say where the page
  // goes. See the product admin, which does the same thing for the same reason.
  // ---------------------------------------------------------------------------------------
  describe('scroll position', () => {
    let scrolled: { id: string; block: ScrollLogicalPosition }[];

    function trackScrolling(page: HeroSlideManagement) {
      scrolled = [];
      // scrollTo resolves the element by id and gives up silently if it never appears, so the
      // assertion is on the request, not on a DOM node the test would have to fabricate.
      (page as unknown as { scrollTo: (id: string, block: ScrollLogicalPosition) => void }).scrollTo =
        (id, block) => scrolled.push({ id, block });
      return page;
    }

    it('goes to the top of the form when one is opened to add a slide', () => {
      const page = trackScrolling(setup());
      page.startCreate();
      expect(scrolled).toEqual([{ id: 'hero-slide-form', block: 'start' }]);
    });

    it('goes to the top of the form when one is opened to edit a slide', () => {
      const page = trackScrolling(setup());
      page.startEdit(slide({ id: 'abc' }));
      expect(scrolled).toEqual([{ id: 'hero-slide-form', block: 'start' }]);
    });

    it('goes to the saved card after saving, not wherever the form left the page', () => {
      const page = trackScrolling(setup());
      service.createSlide.and.returnValue(of(slide({ id: 'saved-1' })));

      page.startCreate();
      page.formData.update((d) => ({ ...d, imageUrl: '/media/a.webp', altText: 'A poster' }));
      page.save();

      expect(scrolled.at(-1)).toEqual({ id: 'hero-slide-saved-1', block: 'center' });
      // ...and the card is marked, so it is obvious which row changed on arrival.
      expect(page.justSavedId()).toBe('saved-1');
    });

    it('goes to the saved card after editing an existing slide too', () => {
      const page = trackScrolling(setup());
      service.updateSlide.and.returnValue(of(slide({ id: 'abc', altText: 'Updated' })));

      page.startEdit(slide({ id: 'abc' }));
      page.save();

      expect(scrolled.at(-1)).toEqual({ id: 'hero-slide-abc', block: 'center' });
    });

    it('goes back to the row it came from when an edit is cancelled', () => {
      const page = trackScrolling(setup());
      page.startEdit(slide({ id: 'abc' }));
      page.cancelForm();

      expect(scrolled.at(-1)).toEqual({ id: 'hero-slide-abc', block: 'center' });
    });

    it('goes to the top when adding is cancelled, since there is no row to return to', () => {
      const page = trackScrolling(setup());
      page.startCreate();
      page.cancelForm();

      expect(scrolled.at(-1)).toEqual({ id: 'hero-slide-list-top', block: 'start' });
    });

    it('goes to the top after a delete, since the list just got shorter', () => {
      const page = trackScrolling(setup());
      spyOn(window, 'confirm').and.returnValue(true);

      page.deleteSlide(slide({ id: 'abc' }));

      expect(scrolled.at(-1)).toEqual({ id: 'hero-slide-list-top', block: 'start' });
    });

    it('does not move the page for a show/hide toggle, which swaps no view', () => {
      const page = trackScrolling(setup());
      page.toggleActive(slide({ id: 'abc' }));

      expect(scrolled).toEqual([]);
    });
  });

  it('counts only the slides that are actually on the home page', () => {
    const page = setup();

    slides.set([
      slide({ id: 'a' }),
      slide({ id: 'b', isActive: false }),
      slide({ id: 'c', imageUrl: '' }),
    ]);

    expect(page.liveCount()).toBe(1);
  });

  it('reports zero live slides so the fallback notice can explain itself', () => {
    const page = setup();

    slides.set([slide({ isActive: false })]);

    expect(page.liveCount()).toBe(0);
    expect(page.shippedSlides.length).toBeGreaterThan(0);
  });

  it('puts a new slide at the end of the rail rather than tied with an existing one', () => {
    const page = setup();

    slides.set([slide({ id: 'a', sortOrder: 0 }), slide({ id: 'b', sortOrder: 4 })]);
    page.startCreate();

    expect(page.formData().sortOrder).toBe(5);
    expect(page.editingId()).toBe('new');
  });

  it('refuses to save a slide with no picture', () => {
    const page = setup();

    page.startCreate();
    page.formData.update((d) => ({ ...d, imageUrl: '', altText: 'Something' }));
    page.save();

    expect(service.createSlide).not.toHaveBeenCalled();
    expect(page.hasError('imageUrl')).toBeTrue();
  });

  it('refuses to save a slide with no description', () => {
    const page = setup();

    // These posters carry printed words, so an undescribed slide drops real content for anyone
    // on a screen reader — not a nicety, which is why it is enforced rather than hinted at.
    page.startCreate();
    page.formData.update((d) => ({ ...d, imageUrl: '/media/a.webp', altText: '   ' }));
    page.save();

    expect(service.createSlide).not.toHaveBeenCalled();
    expect(page.hasError('altText')).toBeTrue();
  });

  it('trims what it sends and closes the form on success', () => {
    const page = setup();

    page.startCreate();
    page.formData.update((d) => ({
      ...d,
      imageUrl: '  /media/a.webp  ',
      altText: '  A poster  ',
      linkUrl: '  /products  ',
    }));
    page.save();

    const sent = service.createSlide.calls.mostRecent().args[0] as UpdateHeroSlideRequest;
    expect(sent.imageUrl).toBe('/media/a.webp');
    expect(sent.altText).toBe('A poster');
    expect(sent.linkUrl).toBe('/products');
    expect(page.editingId()).toBeNull();
    expect(page.submitting()).toBeFalse();
  });

  it('keeps the form open when the save fails', () => {
    const page = setup();
    service.createSlide.and.returnValue(throwError(() => ({ error: { message: 'nope' } })));

    page.startCreate();
    page.formData.update((d) => ({ ...d, imageUrl: '/media/a.webp', altText: 'A poster' }));
    page.save();

    expect(page.editingId()).toBe('new');
    expect(page.submitting()).toBeFalse();
    expect(snackBar.open).toHaveBeenCalledWith('nope', 'Close', jasmine.anything());
  });

  it('edits an existing slide in place rather than creating a second one', () => {
    const page = setup();

    page.startEdit(slide({ id: 'abc', altText: 'Existing' }));
    page.save();

    expect(service.updateSlide).toHaveBeenCalled();
    expect(service.updateSlide.calls.mostRecent().args[0]).toBe('abc');
    expect(service.createSlide).not.toHaveBeenCalled();
  });

  it('flips a slide between live and hidden without touching anything else about it', () => {
    const page = setup();
    const existing = slide({ id: 'abc', isActive: true, sortOrder: 3, altText: 'A poster' });

    page.toggleActive(existing);

    const [id, sent] = service.updateSlide.calls.mostRecent().args as [string, UpdateHeroSlideRequest];
    expect(id).toBe('abc');
    expect(sent.isActive).toBeFalse();
    expect(sent.sortOrder).toBe(3);
    expect(sent.altText).toBe('A poster');
    expect(sent.imageUrl).toBe(existing.imageUrl);
  });

  it('fits a picked poster to the 2:1 frame first, then stores the URL the framed poster was given', () => {
    const page = setup();
    const uploaded: UploadedImage = { url: '/media/stored.webp', width: 2000, height: 1000 };
    media.uploadPrepared.and.returnValue(of(uploaded));

    page.startCreate();
    const input = document.createElement('input');
    const file = new File(['x'], 'poster.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    page.onImageSelected({ target: input } as unknown as Event);

    // Opened in the framer; nothing is uploaded until the admin accepts how it fits.
    expect(page.framingFile()).toBe(file);
    expect(media.upload).not.toHaveBeenCalled();
    expect(media.uploadPrepared).not.toHaveBeenCalled();

    const framed = new Blob(['framed'], { type: 'image/webp' });
    page.onFramed(framed);

    // Uploaded exactly as the framer made it - not re-compressed a second time.
    expect(media.uploadPrepared).toHaveBeenCalledWith(framed);
    expect(page.framingFile()).toBeNull();
    expect(page.formData().imageUrl).toBe('/media/stored.webp');
    expect(page.uploadingImage()).toBeFalse();
  });

  it('does not upload a file the media service rejects', () => {
    const page = setup();
    media.validate.and.returnValue('Too big');

    page.startCreate();
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'huge.jpg', { type: 'image/jpeg' })],
    });
    page.onImageSelected({ target: input } as unknown as Event);

    expect(media.upload).not.toHaveBeenCalled();
    expect(page.framingFile()).toBeNull();
    expect(snackBar.open).toHaveBeenCalledWith('Too big', 'Close', jasmine.anything());
  });

  it('only deletes once the admin has confirmed', () => {
    const page = setup();

    spyOn(window, 'confirm').and.returnValue(false);
    page.deleteSlide(slide({ id: 'abc' }));
    expect(service.deleteSlide).not.toHaveBeenCalled();

    (window.confirm as jasmine.Spy).and.returnValue(true);
    page.deleteSlide(slide({ id: 'abc' }));
    expect(service.deleteSlide).toHaveBeenCalledWith('abc');
  });
});
