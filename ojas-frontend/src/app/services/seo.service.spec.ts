import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { PAGE_JSON_LD_ID, SeoService } from './seo.service';
import { ABOUT_SEO, HOME_SEO, NOT_FOUND_SEO, SHARE_IMAGE, SITE_URL } from '../constants/seo';

@Component({ template: '' })
class Blank {}

describe('SeoService', () => {
  let service: SeoService;
  let router: Router;
  let meta: Meta;
  let title: Title;
  let doc: Document;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: Blank, data: { seo: 'home' } },
          { path: 'about', component: Blank, data: { seo: 'about' } },
          { path: 'products/:id', component: Blank, data: { seo: 'page' } },
          { path: 'cart', component: Blank },
          { path: '**', component: Blank, data: { seo: 'not-found' } },
        ]),
      ],
    });
    service = TestBed.inject(SeoService);
    router = TestBed.inject(Router);
    meta = TestBed.inject(Meta);
    title = TestBed.inject(Title);
    doc = TestBed.inject(DOCUMENT);
  });

  // The test runner shares one document between specs, so nothing written here may leak.
  afterEach(() => {
    doc.head.querySelector('link[rel="canonical"]')?.remove();
    doc.getElementById(PAGE_JSON_LD_ID)?.remove();
    for (const selector of ['name="robots"', 'name="description"', 'property="og:url"']) {
      meta.removeTag(selector);
    }
  });

  const canonical = () => doc.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
  const tag = (selector: string) => meta.getTag(selector)?.content ?? null;
  const jsonLd = () => doc.getElementById(PAGE_JSON_LD_ID)?.textContent ?? null;

  it('describes a page: title, description, canonical address and preview tags', () => {
    service.apply({ title: 'Upwas Flours | Ojas', description: 'Fasting flours', canonicalPath: '/products?category=Upwas' });

    expect(title.getTitle()).toBe('Upwas Flours | Ojas');
    expect(tag('name="description"')).toBe('Fasting flours');
    expect(canonical()).toBe(`${SITE_URL}/products?category=Upwas`);
    expect(tag('property="og:url"')).toBe(`${SITE_URL}/products?category=Upwas`);
    expect(tag('property="og:title"')).toBe('Upwas Flours | Ojas');
    expect(tag('property="og:image"')).toBe(SHARE_IMAGE);
    expect(tag('property="og:image:width"')).toBe('1280');
    expect(tag('name="robots"')).toBeNull();
  });

  it('keeps a noindex page out of search: robots tag, and no canonical or og:url', () => {
    service.apply({ title: 'A', description: 'a', canonicalPath: '/a' });
    service.apply({ title: 'Hidden', description: 'h', noindex: true });

    expect(tag('name="robots"')).toBe('noindex, follow');
    expect(canonical()).toBeNull();
    expect(tag('property="og:url"')).toBeNull();
  });

  it('writes the page structured data, and removes it when the next page has none', () => {
    service.apply({ title: 'P', description: 'p', jsonLd: [{ '@type': 'Product', name: 'Modak Pith' }] });
    expect(JSON.parse(jsonLd()!)).toEqual({ '@type': 'Product', name: 'Modak Pith' });

    service.apply({ title: 'P', description: 'p', jsonLd: [{ '@type': 'Product' }, { '@type': 'BreadcrumbList' }] });
    expect(JSON.parse(jsonLd()!).length).toBe(2);
    expect(doc.querySelectorAll(`#${PAGE_JSON_LD_ID}`).length).toBe(1);

    service.apply({ title: 'Q', description: 'q' });
    expect(jsonLd()).toBeNull();
  });

  it('never lets a value close the script element early', () => {
    service.apply({ title: 'P', description: 'p', jsonLd: [{ name: '</script><b>' }] });

    expect(jsonLd()).not.toContain('</script>');
    expect(JSON.parse(jsonLd()!).name).toBe('</script><b>');
  });

  it("drops the poster's dimensions when a page shows its own picture", () => {
    service.apply({ title: 'P', description: 'p', image: `${SITE_URL}/images/modak-pith-front.webp` });

    expect(tag('property="og:image"')).toBe(`${SITE_URL}/images/modak-pith-front.webp`);
    expect(tag('property="og:image:width"')).toBeNull();
  });

  it("applies a route's SEO on navigation, canonical without the query string", async () => {
    await router.navigateByUrl('/about?utm_source=whatsapp');

    expect(title.getTitle()).toBe(ABOUT_SEO.title);
    expect(canonical()).toBe(`${SITE_URL}/about`);
  });

  it('describes the open page at once when it arrives after the first navigation', async () => {
    // It is fetched in its own chunk after start-up, so the first page can be open already.
    await router.navigateByUrl('/about');
    title.setTitle('stale');

    TestBed.runInInjectionContext(() => new SeoService());

    expect(title.getTitle()).toBe(ABOUT_SEO.title);
  });

  it('gives the home page its canonical with the trailing slash', async () => {
    await router.navigateByUrl('/');

    expect(title.getTitle()).toBe(HOME_SEO.title);
    expect(canonical()).toBe(`${SITE_URL}/`);
  });

  it('keeps a route with no SEO of its own out of the index', async () => {
    await router.navigateByUrl('/cart');

    expect(tag('name="robots"')).toBe('noindex, follow');
    expect(canonical()).toBeNull();
  });

  it('keeps an unknown address out of the index', async () => {
    await router.navigateByUrl('/no/such/page');

    expect(title.getTitle()).toBe(NOT_FOUND_SEO.title);
    expect(tag('name="robots"')).toBe('noindex, follow');
  });

  it('leaves a page that sets its own SEO alone', async () => {
    service.apply({ title: 'Modak Pith | Ojas', description: 'm', canonicalPath: '/products/modak-pith' });

    await router.navigateByUrl('/products/modak-pith');

    expect(title.getTitle()).toBe('Modak Pith | Ojas');
    expect(canonical()).toBe(`${SITE_URL}/products/modak-pith`);
  });
});
