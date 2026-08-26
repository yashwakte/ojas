import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';

/** What the media endpoint hands back once an image is stored. */
export interface UploadedImage {
  url: string;
  width: number;
  height: number;
}

/** How wide an image is allowed to be once stored, by where it will be shown. */
export const IMAGE_PRESETS = {
  /** Full-bleed campaign artwork, the widest thing on the storefront. */
  banner: { maxWidth: 1600, quality: 0.82 },
  /** Product photography: a detail page hero at most, never wider. */
  product: { maxWidth: 1000, quality: 0.82 },
} as const;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

/** Anything larger than this is refused before we spend time decoding it. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

/**
 * Turns whatever an admin picked off their desktop into a small, modern, cacheable image on
 * the server, and returns the URL to reference it by.
 *
 * The re-encoding happens here, in the browser, rather than on the API. That is deliberate:
 * image transcoding is by a wide margin the most CPU-hungry thing this application could ask a
 * server to do, and the API's job is to answer orders quickly on a small shared instance. The
 * admin's laptop is idle at the moment they press "upload" and is the right place to spend
 * those few hundred milliseconds. It also means the API needs no native image library, which
 * keeps its container small and its deployments boring.
 *
 * The gain is not marginal. The campaign photo that was live in production was a 2.7 MB PNG -
 * a photograph saved in a format meant for line art - inlined into a JSON response as base64.
 * Downscaled to 1600px and re-encoded as WebP, the same picture is a small fraction of that,
 * and because it is stored under a content-addressed URL it is then cached for a year.
 */
@Injectable({ providedIn: 'root' })
export class MediaUploadService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/media`;

  upload(file: File, preset: ImagePreset): Observable<UploadedImage> {
    return from(this.optimise(file, preset)).pipe(
      switchMap((blob) => {
        const form = new FormData();
        // The server sniffs the real format from the bytes, so the filename here is only ever
        // for humans reading logs.
        form.append('file', blob, `upload.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`);
        return this.http.post<UploadedImage>(this.endpoint, form);
      }),
    );
  }

  /** Human-readable reason this file can't be uploaded at all, or null if it's fine. */
  validate(file: File): string | null {
    if (!file.type.startsWith('image/')) return 'Please select a valid image file';
    if (file.size > MAX_SOURCE_BYTES) return 'Image must be smaller than 12MB';
    return null;
  }

  private async optimise(file: File, preset: ImagePreset): Promise<Blob> {
    const { maxWidth, quality } = IMAGE_PRESETS[preset];
    const source = await this.decode(file);

    // Never scale up. Enlarging a small image invents no detail and only costs bytes.
    const scale = Math.min(1, maxWidth / source.width);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(source, 0, 0, width, height);

    if ('close' in source) source.close();

    const encoded = await this.toBlob(canvas, quality);

    // A tiny, already-optimised source can come out of a re-encode slightly larger. When that
    // happens the original is simply the better file, so keep it.
    return encoded && encoded.size < file.size ? encoded : file;
  }

  private async decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
    // createImageBitmap decodes off the main thread, so a large photo doesn't freeze the admin
    // screen while it is being prepared. Older Safari needs the <img> path.
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file);
      } catch {
        // Fall through to the element-based decode below.
      }
    }

    const url = URL.createObjectURL(file);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('That file could not be read as an image.'));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => {
      // WebP is supported everywhere the storefront runs; JPEG is the belt-and-braces fallback
      // for a browser whose canvas refuses it, in which case toBlob hands back null.
      canvas.toBlob(
        (webp) => (webp ? resolve(webp) : canvas.toBlob(resolve, 'image/jpeg', quality)),
        'image/webp',
        quality,
      );
    });
  }
}
