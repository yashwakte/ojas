import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import {
  PRIVATE_PAGE_SEO,
  PageSeo,
  ROUTE_SEO,
  RouteSeoKey,
  SEO_SET_BY_PAGE,
  SHARE_IMAGE,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  absoluteUrl,
} from '../constants/seo';

/** The id of the one <script type="application/ld+json"> this service owns. index.html has its
 * own, for the organisation and the website, which this never touches. */
export const PAGE_JSON_LD_ID = 'page-structured-data';

/**
 * Keeps the document head describing the page on screen: title, description, canonical address,
 * robots, link-preview tags and the page's structured data.
 *
 * Google renders this app and reads the head as it stands once the page has settled, so a page
 * that sets its own SEO after its data arrives is read correctly. Routes whose `data.seo` names
 * a page (see RouteSeoKey) are handled here on every navigation; pages marked SEO_SET_BY_PAGE
 * call `apply` themselves; any route with neither — cart, checkout, account, staff — is kept out
 * of the index.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);

  constructor() {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.applyRouteSeo());

    // This service arrives in its own chunk after the app has started (see app.config), so the
    // first navigation can be over before it exists. When it is, describe that page now.
    if (this.router.navigated) this.applyRouteSeo();
  }

  apply(page: PageSeo): void {
    this.title.setTitle(page.title);
    this.meta.updateTag({ name: 'description', content: page.description });

    if (page.noindex) {
      this.meta.updateTag({ name: 'robots', content: 'noindex, follow' });
    } else {
      this.meta.removeTag('name="robots"');
    }

    // A page kept out of the index has no address to be indexed under.
    const canonical = page.noindex ? null : absoluteUrl(page.canonicalPath ?? this.currentPath());
    this.setCanonical(canonical);

    const image = page.image ?? SHARE_IMAGE;
    this.meta.updateTag({ property: 'og:title', content: page.title });
    this.meta.updateTag({ property: 'og:description', content: page.description });
    this.meta.updateTag({ property: 'og:type', content: page.type ?? 'website' });
    this.meta.updateTag({ property: 'og:image', content: image });
    if (image === SHARE_IMAGE) {
      this.meta.updateTag({ property: 'og:image:width', content: String(SHARE_IMAGE_WIDTH) });
      this.meta.updateTag({ property: 'og:image:height', content: String(SHARE_IMAGE_HEIGHT) });
    } else {
      // The poster's dimensions would be a lie about a pack shot.
      this.meta.removeTag('property="og:image:width"');
      this.meta.removeTag('property="og:image:height"');
    }
    if (canonical) {
      this.meta.updateTag({ property: 'og:url', content: canonical });
    } else {
      this.meta.removeTag('property="og:url"');
    }
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });

    this.setJsonLd(page.jsonLd ?? []);
  }

  private applyRouteSeo(): void {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;

    const key = route.data['seo'] as RouteSeoKey | undefined;
    if (key === SEO_SET_BY_PAGE) return;
    this.apply(key ? ROUTE_SEO[key] : PRIVATE_PAGE_SEO);
  }

  /** The address on screen without its query or fragment, which is never part of a canonical. */
  private currentPath(): string {
    return this.router.url.split(/[?#]/)[0] || '/';
  }

  private setCanonical(href: string | null): void {
    let link = this.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!href) {
      link?.remove();
      return;
    }
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', href);
  }

  private setJsonLd(blocks: readonly Record<string, unknown>[]): void {
    let script = this.document.getElementById(PAGE_JSON_LD_ID);
    if (blocks.length === 0) {
      script?.remove();
      return;
    }
    if (!script) {
      script = this.document.createElement('script');
      script.setAttribute('type', 'application/ld+json');
      script.id = PAGE_JSON_LD_ID;
      this.document.head.appendChild(script);
    }
    // "<" escaped so no value in the data - a product name, a description - can ever close the
    // script element early. JSON parsers read < as the same character.
    script.textContent = JSON.stringify(blocks.length === 1 ? blocks[0] : blocks).replace(
      /</g,
      '\\u003c',
    );
  }
}
