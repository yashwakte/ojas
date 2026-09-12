import { Product } from '../models/interfaces';

/**
 * Product search, done in the browser against the catalogue the page already holds.
 *
 * The catalogue is a few dozen products and is loaded once per visit, so a round trip per
 * keystroke would only add latency. What matters far more than where it runs is that it finds
 * what people actually type. Nobody in Pune searches for "sorghum flour": they type jowar, or
 * jwari, or ज्वारी. The labels print the Marathi names; the listings mostly carry the English
 * ones. The alias table below is what joins the two up.
 */

/** Other names a shopper uses for a product, keyed by a fragment of the product's own name. */
const PRODUCT_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['sorghum', ['jowar', 'jowari', 'jwari', 'ज्वारी', 'ज्वार']],
  ['bajra', ['bajri', 'pearl millet', 'बाजरी']],
  ['ragi', ['nachni', 'nachani', 'finger millet', 'नाचणी', 'नाचनी']],
  ['rice', ['tandul', 'chawal', 'तांदूळ', 'चावल']],
  ['rajgira', ['amaranth', 'ramdana', 'राजगिरा']],
  ['buckwheat', ['kuttu', 'kootu', 'कुट्टू']],
  ['shingada', ['singhara', 'singhada', 'water chestnut', 'शिंगाडा']],
  ['bhagar', ['varai', 'vari', 'sama', 'samo', 'barnyard', 'भगर', 'वरई']],
  ['upvas', ['upwas', 'fasting', 'vrat', 'उपवास']],
  ['sattu', ['chana', 'gram', 'सत्तू']],
  ['daliya', ['dalia', 'lapsi', 'broken wheat', 'दलिया']],
  ['modak', ['ukadiche', 'मोदक']],
  ['anarasa', ['anarse', 'anarsa', 'अनारसे']],
  ['custard', ['dessert', 'pudding']],
  ['corn flour', ['cornflour', 'corn starch', 'cornstarch', 'makai']],
  ['rock salt', ['sendha', 'sendha namak', 'saindhav', 'सैंधव']],
  ['black salt', ['kala namak', 'sanchal', 'काळे मीठ']],
  ['dry ginger', ['sonth', 'soonth', 'sunth', 'सुंठ']],
  ['cinnamon', ['dalchini', 'दालचिनी']],
  ['jeshthamadh', ['mulethi', 'licorice', 'liquorice', 'yashtimadhu', 'ज्येष्ठमध']],
  ['monosodium', ['msg', 'ajinomoto']],
  ['citric', ['nimbu sat', 'limbu phool', 'lemon salt']],
  ['yeast', ['khamir']],
  ['baking soda', ['soda', 'bicarbonate', 'meetha soda']],
  ['cocoa', ['chocolate']],
  ['thalipeeth', ['thalipith', 'थालीपीठ']],
  ['amboli', ['ghavan', 'ghavne', 'आंबोळी']],
];

/**
 * Words that mean the same thing in a search box. "Atta" is how most people say flour, and the
 * packs themselves say pith or peeth.
 */
const TERM_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  atta: ['flour'],
  aata: ['flour'],
  ata: ['flour'],
  pith: ['flour', 'peeth'],
  peeth: ['flour', 'pith'],
  flour: ['pith', 'peeth'],
  fasting: ['upwas', 'upvas'],
  upvas: ['upwas'],
  upwas: ['upvas'],
};

/** Suggestions for an empty search box: the searches that find something on this catalogue. */
export const POPULAR_SEARCHES: readonly string[] = [
  'Jowar',
  'Ragi',
  'Upwas',
  'Custard',
  'Rajgira',
  'Modak',
];

/**
 * Lower-cases, strips Latin accents and turns punctuation into spaces.
 *
 * Devanagari vowel signs are Unicode *marks*, not letters, so the character class keeps \p{M} —
 * dropping marks would split नाचणी into pieces that match nothing.
 */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

function aliasesFor(name: string): string {
  const lower = name.toLowerCase();
  return PRODUCT_ALIASES.filter(([fragment]) => lower.includes(fragment))
    .flatMap(([, aliases]) => aliases)
    .join(' ');
}

/** Edit distance, stopping early once it cannot come in under `max`. */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

/** How many typos a word of this length may carry and still count. Short words get none. */
function typoAllowance(term: string): number {
  if (term.length >= 7) return 2;
  if (term.length >= 4) return 1;
  return 0;
}

interface Fields {
  name: string;
  aliases: string;
  category: string;
  body: string;
}

function startsAWord(field: string, term: string): boolean {
  return field.startsWith(term) || field.includes(` ${term}`);
}

/** The best score one search term earns against one product, or 0 if it does not match. */
function scoreTerm(fields: Fields, term: string): number {
  const variants = [term, ...(TERM_SYNONYMS[term] ?? [])];
  let best = 0;

  for (const v of variants) {
    if (startsAWord(fields.name, v)) best = Math.max(best, 30);
    else if (fields.name.includes(v)) best = Math.max(best, 20);
    if (startsAWord(fields.aliases, v)) best = Math.max(best, 24);
    else if (fields.aliases.includes(v)) best = Math.max(best, 14);
    if (fields.category.includes(v)) best = Math.max(best, 10);
    if (v.length >= 3 && fields.body.includes(v)) best = Math.max(best, 3);
  }
  if (best > 0) return best;

  // Nothing matched as typed. Try it as a typo of a word in the name or the aliases, so "raagi"
  // and "jwoar" still find something.
  const allowance = typoAllowance(term);
  if (allowance === 0) return 0;
  const words = `${fields.name} ${fields.aliases}`.split(' ');
  return words.some((w) => w.length >= 3 && withinEdits(term, w, allowance)) ? 8 : 0;
}

/** How well a product matches a query. 0 means it does not; every word must match something. */
export function scoreProduct(product: Product, query: string): number {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  if (terms.length === 0) return 0;

  const fields: Fields = {
    name: normalizeSearchText(product.name),
    aliases: normalizeSearchText(aliasesFor(product.name)),
    category: normalizeSearchText(product.category),
    body: normalizeSearchText(`${product.description} ${product.weight}`),
  };

  let total = 0;
  for (const term of terms) {
    const score = scoreTerm(fields, term);
    if (score === 0) return 0;
    total += score;
  }

  // Someone who has typed the start of a product's name has told us exactly which one they want.
  if (fields.name.startsWith(normalizeSearchText(query))) total += 25;
  return total;
}

/** The products matching a query, best first. An empty query matches nothing. */
export function searchProducts(products: readonly Product[], query: string): Product[] {
  return products
    .map((product) => ({ product, score: scoreProduct(product, query) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
    .map((hit) => hit.product);
}
