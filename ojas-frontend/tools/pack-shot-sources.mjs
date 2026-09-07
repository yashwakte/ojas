/**
 * Which of the client's photographs is which product.
 *
 * The originals arrive from a phone and a studio with names that carry no meaning — `1.1.jpg`,
 * `IMG-20260831-WA0031.jpg.jpeg` — so the mapping has to live somewhere. It lives here rather than
 * in someone's head, because the last time it did not, the originals were downscaled to 1200x800,
 * cut out with a soft selection that left a white halo, and the source files were never committed.
 * The published images could then only get worse, never better: there was nothing left to go back
 * to.
 *
 * Every entry was identified by reading the pack's own label in a contact sheet of all 36 files.
 * The `back` of each pack is the nutrition/ingredients panel, which names the product in Devanagari
 * and English — that text is what each mapping below was checked against.
 */
export const PACK_SHOT_SOURCES = {
  // Cartons, photographed on a light gradient at 2744x2743.
  'custard-pineapple': { front: '1.1.jpg', back: '1.2.jpg' },
  'custard-mango': { front: '2.1.jpg', back: '2.2.jpg' },
  'custard-strawberry': { front: '3.1.jpg', back: '3.2.jpg' },
  'custard-vanilla': { front: '4.1.jpg', back: '4.2.jpg' },

  // The kitchen-essentials cartons, delivered May and June 2026 at 1600x1600 and 1086x1085. Corn
  // flour is in this group rather than with the custards because the client re-shot it in the new
  // carton artwork; 5.1/5.2 are the previous design and are kept in source-images as the record of
  // what shipped before, not published.
  'corn-flour': { front: 'IMG-20260514-WA0029.jpg.jpeg', back: 'IMG-20260514-WA0023.jpg.jpeg' },
  'baking-powder': { front: 'IMG-20260514-WA0015.jpg.jpeg', back: 'IMG-20260514-WA0031.jpg.jpeg' },
  'baking-soda': { front: 'IMG-20260514-WA0024.jpg.jpeg', back: 'IMG-20260514-WA0017.jpg.jpeg' },
  'rock-salt': { front: 'IMG-20260514-WA0032.jpg.jpeg', back: 'IMG-20260514-WA0019.jpg.jpeg' },
  'cocoa-powder': { front: 'IMG-20260514-WA0027.jpg.jpeg', back: 'IMG-20260514-WA0021.jpg.jpeg' },
  // Black salt came with a front only — there is no back-panel photograph of it in the delivery.
  'black-salt': { front: 'IMG-20260514-WA0030.jpg.jpeg' },
  'dry-ginger-powder': { front: 'IMG-20260622-WA0013.jpg.jpeg', back: 'IMG-20260622-WA0014.jpg.jpeg' },
  'citric-acid': { front: 'IMG-20260622-WA0015.jpg.jpeg', back: 'IMG-20260629-WA0002.jpg.jpeg' },
  'monosodium-glutamate': { front: 'IMG-20260622-WA0016.jpg.jpeg', back: 'IMG-20260622-WA0017.jpg.jpeg' },
  'active-dry-yeast': { front: 'IMG-20260622-WA0018.jpg.jpeg', back: 'IMG-20260623-WA0014.jpg.jpeg' },
  'jeshthamadh-powder': { front: 'IMG-20260622-WA0020.jpg.jpeg', back: 'IMG-20260622-WA0019.jpg.jpeg' },
  'cinnamon-powder': { front: 'IMG-20260623-WA0012.jpg.jpeg', back: 'IMG-20260623-WA0013.jpg.jpeg' },

  // Pouches, photographed on a dark gradient at 1500x1500 / 1599x1600.
  'upvas-bhajani': { front: 'IMG-20260322-WA0005.jpg.jpeg', back: 'IMG-20260831-WA0040.jpg.jpeg' },
  // Re-shot in the current artwork in September 2026; the back panel is still the 2026-08 photo,
  // which is the same pack from behind.
  'ragi-malt': { front: 'SAVE_20260905_244413.jpg.jpeg', back: 'IMG-20260831-WA0038.jpg.jpeg' },
  'rajgira-flour': { front: 'IMG-20260322-WA0009.jpg.jpeg', back: 'IMG-20260831-WA0036.jpg.jpeg' },
  'buckwheat-flour': { front: 'IMG-20260322-WA0011.jpg.jpeg', back: 'IMG-20260831-WA0037.jpg.jpeg' },
  'chana-sattu': { front: 'IMG-20260322-WA0013.jpg.jpeg', back: 'IMG-20260831-WA0035.jpg.jpeg' },
  'shingada-flour': { front: 'IMG-20260322-WA0014.jpg.jpeg', back: 'IMG-20260831-WA0039.jpg.jpeg' },
  'modak-pith': { front: 'IMG-20260831-WA0021.jpg.jpeg', back: 'IMG-20260831-WA0022.jpg.jpeg' },
  'bajra-flour': { front: 'IMG-20260831-WA0023.jpg.jpeg', back: 'IMG-20260831-WA0025.jpg.jpeg' },
  'anarasa-flour': { front: 'IMG-20260831-WA0024.jpg.jpeg', back: 'IMG-20260831-WA0026.jpg.jpeg' },
  'ragi-flour': { front: 'IMG-20260831-WA0027.jpg.jpeg', back: 'IMG-20260831-WA0032.jpg.jpeg' },
  'rice-flour': { front: 'IMG-20260831-WA0028.jpg.jpeg', back: 'IMG-20260831-WA0030.jpg.jpeg' },
  'sorghum-flour': { front: 'IMG-20260831-WA0033.jpg.jpeg', back: 'IMG-20260831-WA0031.jpg.jpeg' },
  'wheat-daliya': { front: 'IMG-20260831-WA0034.jpg.jpeg', back: 'IMG-20260831-WA0029.jpg.jpeg' },

  // Pouches added in the September 2026 delivery. Amboli and thalipeeth bhajani arrived front-only.
  'bhagar-peeth': { front: 'm2.jpg.jpeg', back: 'm1.jpg.jpeg' },
  'amboli-flour': { front: 'SAVE_20260905_244359.jpg.jpeg' },
  'thalipeeth-bhajani': { front: 'IMG-20260717-WA0019.jpg.jpeg' },
};
