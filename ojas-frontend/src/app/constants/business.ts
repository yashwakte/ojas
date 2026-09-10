/**
 * Who Ojas actually is, in one place.
 *
 * Ojas is the brand; Asha Marketing is the company behind it. The name, the registered address
 * and the FSSAI licence appear on the About page, in the footer and across all four policy
 * documents, and every one of those is read by a customer or a payment provider's compliance
 * review as a statement of fact. Keeping them here rather than retyped per template is what stops
 * the footer and the Terms page disagreeing about the address of the same business.
 */

export const BUSINESS_NAME = 'Asha Marketing';
export const BRAND_NAME = 'Ojas';

export const SUPPORT_EMAIL = 'wecare@ojasaata.com';
export const SUPPORT_PHONE = '+91 8657781526';
/** The same number with the spacing stripped, for `tel:` links — a dialler should not have to
 * cope with the space that makes the printed form readable. */
export const SUPPORT_PHONE_HREF = `tel:${SUPPORT_PHONE.replace(/\s+/g, '')}`;

export const SUPPORT_HOURS = 'Monday to Saturday, 9:00am – 7:00pm IST';

/** The registered address, split so a template can stack it over several lines and the policy
 * pages can join it back into a single sentence. */
export const REGISTERED_ADDRESS_LINES: readonly string[] = [
  'Near Chhatrapati Shivaji Maharaj Udyan,',
  'Madhuban Society Lane No. 9,',
  'Old Sanghvi, Pune – 411027,',
  'Maharashtra, India',
];

export const REGISTERED_ADDRESS = REGISTERED_ADDRESS_LINES.join(' ')
  .replace(/,\s+/g, ', ')
  .trim();

/**
 * The FSSAI licence number for Asha Marketing, as printed on the packs.
 *
 * Every surface that mentions the licence reads it from here, and each falls back to "the number
 * is printed on each pack" if it is ever blanked — publishing a guessed or placeholder licence
 * number would be a false compliance claim, which is worse than saying nothing.
 */
export const FSSAI_LICENCE_NUMBER = '11526082000125';

export const INSTAGRAM_HANDLE = 'ojas.aata';
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

/**
 * How long after delivery a customer may send an unopened pack back, in days.
 *
 * Lives here because four separate surfaces state this number to the customer — the Refunds and
 * Cancellations policy, the Terms, the cart's promise block and the product page's delivery card —
 * and a returns window that reads as three days in one place and five in another is the kind of
 * mismatch a customer will hold us to. Change it here and every surface follows.
 */
export const RETURN_WINDOW_DAYS = 3;
