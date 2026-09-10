import { LEGAL_DOCUMENTS } from './legal-content';
import { RETURN_WINDOW_DAYS } from '../../constants/business';

/**
 * These are compliance assertions, not rendering ones. The policy text is the thing a customer
 * and a payment gateway's reviewer act on, so the two failure modes worth pinning are a promise
 * disappearing and two promises contradicting each other.
 */
describe('legal content', () => {
  /** Every word of a document, flattened, so a claim can be searched for wherever it lives. */
  const textOf = (slug: string): string => {
    const doc = LEGAL_DOCUMENTS[slug];
    expect(doc).withContext(`no policy document for slug "${slug}"`).toBeTruthy();
    return [
      doc.intro,
      ...doc.sections.flatMap((s) => [
        s.heading,
        ...(s.paragraphs ?? []),
        ...(s.bullets ?? []),
        s.footnote ?? '',
      ]),
    ]
      .join(' ')
      .toLowerCase();
  };

  it('states the returns window in the refunds policy, with its conditions', () => {
    const refunds = textOf('refunds');

    expect(refunds).toContain(`${RETURN_WINDOW_DAYS} days from delivery`);
    expect(refunds).toContain('unopened');
    expect(refunds).toContain('original packaging');
    // Free collection is the part a customer is most likely to be charged for by mistake if the
    // promise is ever quietly dropped.
    expect(refunds).toContain('no charge');
  });

  it('repeats the returns window in the terms, which incorporate the refunds policy', () => {
    expect(textOf('terms')).toContain(`${RETURN_WINDOW_DAYS} days`);
  });

  it('no longer offers refusing a delivery at the door', () => {
    // Withdrawn by the owner on 2026-09-10: "The checking at door policy should be removed now
    // completely. We are not supporting that." A policy page that still offers it would have a
    // customer handing the box back to a delivery partner who has no instruction that matches.
    for (const slug of Object.keys(LEGAL_DOCUMENTS)) {
      const text = textOf(slug);
      expect(text).not.toContain('at the door');
      expect(text).not.toContain('refuse');
    }
  });

  it('tells the customer where the return button actually is', () => {
    // The policy predated the flow and said to call us. A policy that describes a process the
    // software no longer uses sends people to the phone for something they could do themselves.
    expect(textOf('refunds')).toContain('my orders');
    expect(textOf('refunds')).toContain('return items');
  });

  it('no longer claims anywhere that there is no returns window', () => {
    // The policy said exactly this until the owner introduced returns on 2026-09-09. A page that
    // still carries the old sentence beside the new one is worse than either on its own.
    for (const slug of Object.keys(LEGAL_DOCUMENTS)) {
      expect(textOf(slug)).not.toContain('do not operate a returns window');
    }
  });
});
