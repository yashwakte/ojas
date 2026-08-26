import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MediaUploadService } from './media-upload.service';
import { environment } from '../../environments/environment';

/** A real 2x2 PNG, so the browser's decoder has something it will actually accept. */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMCELDBEBAG0nAxOJlAX0AAAAAElFTkSuQmCC';

function tinyPngFile(name = 'tiny.png'): File {
  const binary = atob(TINY_PNG_BASE64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: 'image/png' });
}

describe('MediaUploadService', () => {
  let service: MediaUploadService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MediaUploadService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('validate', () => {
    it('refuses anything that is not an image', () => {
      const file = new File(['plain text'], 'notes.txt', { type: 'text/plain' });
      expect(service.validate(file)).toBe('Please select a valid image file');
    });

    it('refuses a file too large to be worth decoding', () => {
      const file = new File([new Uint8Array(13 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
      expect(service.validate(file)).toBe('Image must be smaller than 12MB');
    });

    it('accepts an ordinary image', () => {
      expect(service.validate(tinyPngFile())).toBeNull();
    });
  });

  it('posts the optimised image as multipart form data and returns the stored URL', async () => {
    let result: { url: string } | undefined;
    service.upload(tinyPngFile(), 'banner').subscribe((image) => (result = image));

    // The canvas encode is asynchronous, so the request is only made once it settles.
    const request = await waitForRequest(http, `${environment.apiUrl}/media`);

    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body instanceof FormData).toBeTrue();
    // Angular must be left to set the multipart boundary itself; an explicit Content-Type here
    // would produce a body the server cannot parse.
    expect(request.request.headers.get('Content-Type')).toBeNull();

    const uploaded = body.get('file') as File;
    expect(uploaded).toBeTruthy();
    // A 2x2 source is below every preset width, so it is passed through rather than enlarged.
    expect(uploaded.size).toBeGreaterThan(0);

    request.flush({ url: '/api/media/deadbeef.webp', width: 2, height: 2 });
    expect(result?.url).toBe('/api/media/deadbeef.webp');
  });

  it('never scales an image up to the preset width', async () => {
    service.upload(tinyPngFile(), 'banner').subscribe();

    const request = await waitForRequest(http, `${environment.apiUrl}/media`);
    const uploaded = request.request.body.get('file') as File;

    // A 2x2 image re-encoded at 1600px would be enormous; passing it through keeps it tiny.
    expect(uploaded.size).toBeLessThan(50 * 1024);
    request.flush({ url: '/api/media/x.webp', width: 2, height: 2 });
  });
});

/** Polls the testing backend until the asynchronous canvas encode has produced its request. */
async function waitForRequest(http: HttpTestingController, url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const matches = http.match(url);
    if (matches.length > 0) return matches[0];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No request to ${url} was made`);
}
