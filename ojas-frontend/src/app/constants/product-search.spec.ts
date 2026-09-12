import { Product } from '../models/interfaces';
import { normalizeSearchText, scoreProduct, searchProducts } from './product-search';

function product(name: string, category = 'Everyday Flours', description = 'desc'): Product {
  return {
    id: name,
    name,
    description,
    price: 50,
    discount: 0,
    category,
    imageUrl: '',
    galleryImageUrls: [],
    weight: '500g',
    isAvailable: true,
    isListed: true,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: '',
    benefits: '',
    storageInfo: '',
    createdAt: '',
    updatedAt: '',
  };
}

describe('product search', () => {
  const catalogue = [
    product('Sorghum Flour'),
    product('Ragi Flour'),
    product('Rice Flour'),
    product('Bajra Flour'),
    product('Buckwheat Flour', 'Upwas'),
    product('Bhagar (Varai) Peeth', 'Upwas'),
    product('Modak Pith', 'Traditional & Festive'),
    product('Custard Powder - Mango Flavour', 'Baking & Desserts'),
    product('Chana Sattu', 'Health & Breakfast', 'Roasted gram, with a little rice for body.'),
  ];
  const find = (q: string) => searchProducts(catalogue, q).map((p) => p.name);

  it('keeps Devanagari vowel signs, which Unicode counts as marks rather than letters', () => {
    expect(normalizeSearchText('नाचणी पीठ')).toBe('नाचणी पीठ');
    expect(normalizeSearchText('  Ragi-Flour! ')).toBe('ragi flour');
  });

  it('finds products by the names people in Pune actually type', () => {
    expect(find('jowar')).toEqual(['Sorghum Flour']);
    expect(find('nachni')).toEqual(['Ragi Flour']);
    expect(find('नाचणी')).toEqual(['Ragi Flour']);
    expect(find('kuttu')).toEqual(['Buckwheat Flour']);
    expect(find('varai')).toEqual(['Bhagar (Varai) Peeth']);
  });

  it('treats atta, pith and peeth as flour', () => {
    expect(find('ragi atta')).toEqual(['Ragi Flour']);
    expect(find('bhagar flour')).toEqual(['Bhagar (Varai) Peeth']);
  });

  it('matches a category', () => {
    expect(find('upwas')).toEqual(['Bhagar (Varai) Peeth', 'Buckwheat Flour']);
  });

  it('forgives a typo in a longer word, but not in a short one', () => {
    expect(find('raagi')).toEqual(['Ragi Flour']);
    expect(find('custrd')).toEqual(['Custard Powder - Mango Flavour']);
    expect(find('rce')).toEqual([]);
  });

  it('needs every word to match something', () => {
    expect(find('ragi custard')).toEqual([]);
  });

  it('ranks a product whose name starts with the query above one that only mentions it', () => {
    // Chana Sattu's description mentions rice; Rice Flour is what someone typing "rice" wants.
    expect(find('rice')[0]).toBe('Rice Flour');
    expect(find('rice')).toContain('Chana Sattu');
  });

  it('matches nothing for an empty query', () => {
    expect(find('')).toEqual([]);
    expect(scoreProduct(catalogue[0], '   ')).toBe(0);
  });
});
