import { TestBed } from '@angular/core/testing';
import { BANNER_FRAME, BannerSlot, ImageFramer } from './image-framer';

/** A real PNG of the given size: a warm field with a cooler block in the middle. */
async function picture(width: number, height: number): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#c86432';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#3264c8';
  ctx.fillRect(width / 4, height / 4, width / 2, height / 2);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  return new File([blob], 'poster.png', { type: 'image/png' });
}

/** Decoding is asynchronous; wait for it rather than guessing how long it takes. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 150 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
}

describe('ImageFramer', () => {
  function create(file: File, slot: BannerSlot = 'hero') {
    TestBed.configureTestingModule({ imports: [ImageFramer] });
    const fixture = TestBed.createComponent(ImageFramer);
    fixture.componentRef.setInput('file', file);
    fixture.componentRef.setInput('slot', slot);
    fixture.detectChanges();
    return fixture;
  }

  it('lets a picture that is already 2:1 fill the banner, with nothing added or cut', async () => {
    const fixture = create(await picture(800, 400));
    const framer = fixture.componentInstance;
    await until(() => framer.ready());

    expect(framer.alreadyFits()).toBeTrue();
    expect(framer.size()).toBe(100);
    expect(framer.crops()).toBeFalse();
    expect(framer.extends()).toBeFalse();
  });

  it('starts any other shape whole, clear of the band the hero buttons sit in', async () => {
    const fixture = create(await picture(900, 600));
    const framer = fixture.componentInstance;
    await until(() => framer.ready());
    const p = framer.placement()!;

    expect(framer.size()).toBe(0);
    expect(framer.crops()).toBeFalse();
    expect(framer.extends()).toBeTrue();
    expect(p.y + p.height).toBeLessThanOrEqual(BANNER_FRAME.height * 0.75 + 0.5);
  });

  it('crops instead when told to fill, and says so', async () => {
    const fixture = create(await picture(900, 600));
    const framer = fixture.componentInstance;
    await until(() => framer.ready());

    framer.setSize(100);
    fixture.detectChanges();

    expect(framer.crops()).toBeTrue();
    expect(framer.extends()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.framer-note').textContent).toContain('cut off');
  });

  it('hands on a 2:1 picture, never wider than the banner preset', async () => {
    const fixture = create(await picture(1200, 800));
    const framer = fixture.componentInstance;
    await until(() => framer.ready());
    const out: Blob[] = [];
    framer.framed.subscribe((b) => out.push(b));

    await framer.use();

    expect(out.length).toBe(1);
    const bitmap = await createImageBitmap(out[0]);
    expect(bitmap.width / bitmap.height).toBeCloseTo(2, 2);
    expect(bitmap.width).toBeLessThanOrEqual(BANNER_FRAME.width);
  });

  it('says so, rather than hanging, when the file is not a picture', async () => {
    const fixture = create(new File(['not an image'], 'notes.png', { type: 'image/png' }));
    const framer = fixture.componentInstance;
    await until(() => framer.failed());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  });
});
