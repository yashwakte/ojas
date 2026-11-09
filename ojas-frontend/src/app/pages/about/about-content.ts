/**
 * The words on the About page.
 *
 * Kept apart from the template because two things print them: the About page itself, and the
 * build step that writes /about as finished HTML for search engines and AI crawlers
 * (tools/prerender). One copy means the page a crawler reads is the page a customer reads.
 */

export const ABOUT_TAGLINE =
  "शुद्ध आहार...शुद्ध विचार — Pure food, pure thoughts. A farming family's chakki, ten years on.";

export const ABOUT_STORY_HEADING = 'From a Farming Family to 1,200+ Shelves';

export const ABOUT_STORY: readonly string[] = [
  "We come from a farmers' background." +
    ' Grain was something our family grew and understood long ' +
    'before it was something we packed and sold, and that is still how we choose it — by handling ' +
    'it, not by reading a spec sheet.',
  'Ojas started as one small outlet in Pune, grinding fresh flour on a stone chakki for the ' +
    'families in the lane. More than ten years later that single shop has become a range of over ' +
    'fifty products stocked in more than 1,200 retail outlets, and we are growing fast across ' +
    'Pune — with a vision to put Ojas on kitchen shelves all over the world.',
  'What has not changed is the method. We still source grain from farms we know, still grind it ' +
    'slowly on traditional stone chakkis to keep every bit of nutrition and flavour, and still ' +
    'pack it fresh — so what reaches your table is as close to nature as we can get it.',
];

export interface AboutValue {
  icon: string;
  title: string;
  desc: string;
}

export const ABOUT_VALUES: readonly AboutValue[] = [
  {
    icon: 'agriculture',
    title: 'Farmers at the Root',
    desc: 'We come from a farming family, so we buy grain the way a farmer would — by looking at it, not at a spec sheet.',
  },
  {
    icon: 'eco',
    title: 'Traditional Process',
    desc: 'Every grain is stone-ground on a chakki, the way our grandmothers did it, to protect flavour and nutrition.',
  },
  {
    icon: 'storefront',
    title: 'Trusted on the Shelf',
    desc: 'Over 1,200 retail outlets stock Ojas. Shopkeepers reorder what their customers come back for, and they have kept coming back.',
  },
  {
    icon: 'verified',
    title: 'Purity First',
    desc: 'No additives, no preservatives, no shortcuts — just grains the way nature made them.',
  },
];

export interface AboutMilestone {
  year: string;
  title: string;
  desc: string;
}

export const ABOUT_MILESTONES: readonly AboutMilestone[] = [
  {
    year: 'Roots',
    title: 'A Farming Family',
    desc: 'Ojas begins where the grain does. Our family farmed it long before we ever packed it, and that is still how we judge what goes into a pack.',
  },
  {
    year: 'Day 1',
    title: 'One Small Outlet',
    desc: 'We opened a single small outlet in Pune, grinding fresh flour on a stone chakki for the families in the lane.',
  },
  {
    year: '1,200+',
    title: 'Across the Shelves',
    desc: 'A decade on, Ojas is stocked in more than 1,200 retail outlets, with a range that has grown past 50 products.',
  },
  {
    year: 'Next',
    title: 'Ojas Everywhere',
    desc: 'Growing fast in Pune, and building towards a simple vision — Ojas on kitchen shelves all over the world.',
  },
];

export const ABOUT_STATS: readonly { value: string; label: string }[] = [
  { value: '10+', label: 'Years of Trust' },
  { value: '50+', label: 'Pure Products' },
  { value: '1,200+', label: 'Retail Outlets' },
  { value: '100%', label: 'Natural Ingredients' },
];

export const ABOUT_COMPANY_INTRO =
  'Every Ojas product is manufactured, packed and marketed by Asha Marketing, a food business ' +
  'based in Pune, Maharashtra. When you order from this site, Asha Marketing is the business you ' +
  'are buying from.';
