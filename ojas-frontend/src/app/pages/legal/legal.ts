import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { LEGAL_DOCUMENTS, POLICY_LAST_UPDATED, LegalDocument } from './legal-content';

/**
 * Renders all four policy pages - Contact, Terms, Refunds and Cancellations, Privacy - from one
 * component, picked by the `slug` on the route's data. The chrome is identical on every one of
 * them, so a single template is both less code and the only way they cannot drift apart visually.
 *
 * The page title is set explicitly because these are the pages a payment gateway's compliance
 * reviewer opens directly, and a browser tab reading only "Ojas" on all four makes it look like
 * the same page served for every link.
 */
@Component({
  selector: 'app-legal',
  imports: [RouterLink],
  templateUrl: './legal.html',
  styleUrl: './legal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Legal {
  private readonly route = inject(ActivatedRoute);
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);

  protected readonly lastUpdated = POLICY_LAST_UPDATED;
  protected readonly doc: LegalDocument;

  constructor() {
    // Read from the snapshot rather than the observable: these routes are separate lazy
    // components as far as the router is concerned, so the component is rebuilt on every
    // navigation between them and there is no in-place slug change to subscribe to.
    const slug = this.route.snapshot.data['slug'] as string;
    this.doc = LEGAL_DOCUMENTS[slug];
    this.titleService.setTitle(`${this.doc.title} · Ojas`);
    this.meta.updateTag({ name: 'description', content: this.doc.intro });
  }
}
