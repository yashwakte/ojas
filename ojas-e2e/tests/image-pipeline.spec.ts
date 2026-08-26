import { test, expect } from './fixtures';
import { MONGO_URL, withDb, deleteUsersByEmail, promoteToAdmin } from './db';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The image pipeline, driven end to end through a real browser:
 *
 *   admin uploads a heavy PNG on the campaign screen
 *     -> the browser downsizes and re-encodes it to WebP before it ever leaves the machine
 *       -> the API stores it under a hash and hands back a URL
 *         -> the campaign document holds that URL, never the image
 *           -> a guest's home page renders it, and the bytes come back cached for a year
 *
 * This is the one path that neither the API integration tests nor the Angular unit tests can
 * cover between them, because it spans a canvas encode in the browser, a multipart POST carrying
 * a CSRF token, model binding, byte-level format sniffing, storage, and finally an <img> on a
 * page served from a different origin than the API in development.
 *
 * That last part is exactly what this spec caught the first time it ran: uploaded images are
 * stored as origin-independent paths (/api/media/{hash}.webp) so one database is correct on
 * every domain Ojas is served from, and in production Vercel's rewrite resolves them - but
 * `ng serve` had no equivalent, so every uploaded image 404ed in local development while being
 * perfectly fine in production. proxy.conf.mjs exists because of this test.
 */

const suffix = Date.now().toString().slice(-8);

const admin = {
  fullName: 'Playwright Image Admin',
  email: `pw.img.${suffix}@example.com`,
  phone: `7${suffix.padEnd(9, '0')}`,
  password: 'Passw0rd123!',
};

/**
 * A stand-in for the kind of file an admin actually uploads: a photographic image — smooth
 * gradients and soft shapes, carrying fine grain — saved as a PNG. That is precisely the mistake
 * the live campaign banner was making, a photograph in a format meant for line art, and it is
 * what the browser-side re-encode exists to undo.
 *
 * The grain matters. A perfectly smooth gradient compresses well even as PNG, and pure noise
 * cannot be beaten by WebP at all (MediaUploadService correctly keeps the original when its
 * re-encode comes out larger). Real photographs sit between the two: lossless PNG has to store
 * every speck of grain, while lossy WebP discards it, which is where the order-of-magnitude
 * saving comes from.
 *
 * Generated rather than committed, so the repository carries no multi-megabyte fixture, and
 * generated in the browser so this package needs no image library of its own.
 */
async function writePhotographicPng(page: import('@playwright/test').Page): Promise<string> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext('2d')!;

    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#f6c88a');
    sky.addColorStop(0.6, '#e8853a');
    sky.addColorStop(1, '#7b3418');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 40; i++) {
      const x = (i * 197) % canvas.width;
      const y = (i * 331) % canvas.height;
      const r = 60 + ((i * 53) % 220);
      const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
      blob.addColorStop(0, `rgba(255, 245, 220, ${0.05 + (i % 7) / 40})`);
      blob.addColorStop(1, 'rgba(120, 40, 10, 0)');
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Film grain: low amplitude, so it looks like a photograph rather than static, but enough to
    // defeat PNG's row filters.
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < frame.data.length; i += 4) {
      const grain = ((i * 2654435761) % 25) - 12;
      frame.data[i] = Math.min(255, Math.max(0, frame.data[i] + grain));
      frame.data[i + 1] = Math.min(255, Math.max(0, frame.data[i + 1] + grain));
      frame.data[i + 2] = Math.min(255, Math.max(0, frame.data[i + 2] + grain));
    }
    ctx.putImageData(frame, 0, 0);

    return canvas.toDataURL('image/png');
  });

  const file = path.join(mkdtempSync(path.join(tmpdir(), 'ojas-img-')), 'heavy.png');
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
}

test.describe('image pipeline', () => {
  test.skip(!MONGO_URL, "Set OJAS_E2E_MONGO_URL to the API's Mongo connection string to run this spec.");

  // Registration, device enrolment, a canvas re-encode and two page loads across two contexts.
  test.setTimeout(180_000);

  test.afterAll(async () => {
    await deleteUsersByEmail([admin.email]);
    await withDb(async (db) => {
      await db.collection('campaign_banner').deleteMany({ ctaText: `Shop ${suffix}` });
    });
  });

  test('an uploaded banner becomes a small, immutably cached WebP the storefront renders', async ({
    page,
    browser,
    request,
  }) => {
    const apiOrigin = 'https://localhost:7126';

    // --- an admin session. page.request shares the page's cookie jar, so signing in through the
    // API leaves the browser genuinely signed in, keeping this spec's attention on the upload UI.
    const registered = await page.request.post(`${apiOrigin}/api/auth/register`, {
      data: { ...admin, turnstileToken: 'test-turnstile-token' },
    });
    expect(registered.ok()).toBeTruthy();
    const pending = await registered.json();

    const verified = await page.request.post(`${apiOrigin}/api/auth/verify-email-otp`, {
      data: { email: admin.email, code: pending.devCode },
    });
    expect(verified.ok()).toBeTruthy();

    await promoteToAdmin(admin.email);

    // Staff accounts are device-restricted, so an admin sign-in is a two-step enrolment rather
    // than a plain login: request a device code, then redeem it.
    const deviceOtp = await page.request.post(`${apiOrigin}/api/auth/device/send-otp`, {
      data: { email: admin.email, password: admin.password },
    });
    const { devCode } = await deviceOtp.json();

    const enrolled = await page.request.post(`${apiOrigin}/api/auth/device/enroll`, {
      data: { email: admin.email, password: admin.password, code: devCode },
    });
    const auth = await enrolled.json();
    expect(auth.role).toBe('admin');

    await page.context().addInitScript((user) => {
      localStorage.setItem('ojas_user', JSON.stringify(user));
    }, auth);

    // --- upload through the real admin screen
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);

    await page.getByRole('tab', { name: /campaign banner/i }).click();

    // Wait for the tab's content, not a timer: the campaign screen is inside a lazily rendered
    // mat-tab, so the create button does not exist the instant the tab is clicked.
    const createButton = page.getByRole('button', { name: /new campaign/i });
    await createButton.click();

    const source = await writePhotographicPng(page);
    const sourceBytes = readFileSync(source).length;

    await page.locator('input[type="file"]').first().setInputFiles(source);

    const urlField = page.locator('input[name="backgroundImageUrl"]');
    await expect(urlField).toHaveValue(/^\/api\/media\/[0-9a-f]{64}\.webp$/, { timeout: 60_000 });
    const stored = await urlField.inputValue();

    // --- what the browser actually gets back
    const served = await request.get(`${apiOrigin}${stored}`, { ignoreHTTPSErrors: true });
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/webp');

    const storedBytes = (await served.body()).length;
    // The whole point of the pipeline: a multi-megabyte upload becomes a small file.
    expect(storedBytes).toBeLessThan(sourceBytes / 4);

    // The one-year immutable cache is only safe because the URL is the hash of the bytes: a
    // changed picture is necessarily a different URL, so no cache can ever hold a stale one.
    expect(served.headers()['cache-control']).toContain('immutable');
    expect(served.headers()['cache-control']).toContain('max-age=31536000');

    const etag = served.headers()['etag'];
    expect(etag).toBeTruthy();
    const revalidated = await request.get(`${apiOrigin}${stored}`, {
      headers: { 'If-None-Match': etag },
      ignoreHTTPSErrors: true,
    });
    expect(revalidated.status()).toBe(304);

    // --- publish it with no title at all, which is the point of making those fields optional
    await page.locator('input[name="ctaText"]').fill(`Shop ${suffix}`);
    await page.locator('mat-slide-toggle').first().click();
    await page.locator('button[type="submit"]').first().click();

    await expect
      .poll(
        async () =>
          withDb(async (db) => db.collection('campaign_banner').findOne({ ctaText: `Shop ${suffix}` })),
        { timeout: 20_000 },
      )
      .not.toBeNull();

    const saved = await withDb(async (db) =>
      db.collection('campaign_banner').findOne({ ctaText: `Shop ${suffix}` }),
    );
    // The image must never be written back into the document it is attached to.
    expect(saved!.backgroundImageUrl).toBe(stored);
    expect(saved!.title ?? '').toBe('');

    // --- and how a customer sees it. A fresh context, because storefrontGuard sends an admin
    // straight back to /admin - an admin session can never see the page it just published to.
    const guestContext = await browser.newContext({ ignoreHTTPSErrors: true });
    await guestContext.addInitScript(() => {
      localStorage.setItem('ojas_visited', '1');
      sessionStorage.setItem('ojas_intro_shown', '1');
    });
    const guest = await guestContext.newPage();

    await guest.goto('/');
    const banner = guest.locator('app-campaign-banner img').first();
    await expect(banner).toHaveAttribute('src', stored);

    // naturalWidth is the honest check: it is only non-zero once the bytes actually decoded, so
    // it fails on a broken URL where a plain visibility assertion would still pass.
    await expect.poll(async () => banner.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    // The topmost banner is the likely largest paint, so it loads eagerly at high priority.
    await expect(banner).toHaveAttribute('fetchpriority', 'high');

    // Nothing is written over the artwork except the call to action.
    await expect(guest.locator('app-campaign-banner h2')).toHaveCount(0);
    await expect(guest.locator('app-campaign-banner .btn-white')).toBeVisible();

    // The campaign response itself is now a handful of bytes rather than the megabytes it was
    // when the image travelled inside it, and guests may be served it from a cache.
    const bannerList = await request.get(`${apiOrigin}/api/campaign-banner`, { ignoreHTTPSErrors: true });
    expect((await bannerList.body()).length).toBeLessThan(4096);
    expect(bannerList.headers()['cache-control']).toContain('stale-while-revalidate');

    await guestContext.close();
  });
});
