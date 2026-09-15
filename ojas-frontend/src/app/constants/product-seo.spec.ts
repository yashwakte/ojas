import { Product } from '../models/interfaces';
import {
  formatWeight,
  productJsonLd,
  productPageSeo,
  productPath,
  productSeoDescription,
  productSeoTitle,
  productsPageSeo,
} from './product-seo';
import { ORGANIZATION_ID, SITE_URL } from './seo';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: '69db536f167fde4aa39e8807',
    slug: 'modak-pith',
    name: 'Modak Pith',
    description: 'Ready-to-use modak pith (flour) for making perfect ukadiche modak.',
    price: 65,
    discount: 0,
    category: 'Traditional & Festive',
    imageUrl: '/images/modak-pith-front.webp?v=20260907',
    galleryImageUrls: ['/images/modak-pith-back.webp?v=20260907'],
    weight: '500g',
    isAvailable: true,
    isListed: true,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: 'Rice',
    benefits: 'Soft shells',
    storageInfo: 'Cool, dry place',
    createdAt: '2026-04-12T08:10:20Z',
    updatedAt: '2026-09-04T20:02:00Z',
    ...overrides,
  };
}

type Block = Record<string, any>;

describe('product SEO', () => {
  describe('productPath', () => {
    it('uses the readable slug', () => {
      expect(productPath(product())).toBe('/products/modak-pith');
    });

    it('falls back to the id for a product the API has not given a slug', () => {
      expect(productPath(product({ slug: undefined }))).toBe('/products/69db536f167fde4aa39e8807');
    });
  });

  describe('the title', () => {
    it("carries the listing's name, the spelling people search and the Marathi from the pack", () => {
      expect(productSeoTitle(product())).toBe('Modak Pith (Modak Peeth) 500 g – मोदक पीठ | Ojas, Pune');
    });

    it('turns "Sorghum Flour" into something a Pune shopper types', () => {
      expect(productSeoTitle(product({ name: 'Sorghum Flour' }))).toBe(
        'Sorghum Flour (Jowar Atta) 500 g – ज्वारी पीठ | Ojas, Pune',
      );
    });

    it('says only what it knows for a product with no local name on record', () => {
      expect(productSeoTitle(product({ name: 'Custard Powder - Vanilla Flavour', weight: '100g' }))).toBe(
        'Custard Powder - Vanilla Flavour 100 g | Ojas, Pune',
      );
    });
  });

  describe('the description', () => {
    it('leads with the names, and states the pack, the price and the delivery promise', () => {
      const text = productSeoDescription(product());

      expect(text.startsWith('Modak Pith (मोदक पीठ) – Ready-to-use modak pith')).toBeTrue();
      expect(text).toContain('500 g pack, ₹65.');
      expect(text).toContain('delivered across Pune in 1–2 days');
    });

    it('quotes the price the checkout charges, after any discount', () => {
      expect(productSeoDescription(product({ price: 100, discount: 10 }))).toContain('₹90.');
    });
  });

  describe('structured data', () => {
    const [productBlock, breadcrumb] = productJsonLd(product()) as Block[];

    it('is a Product sold by the Ojas organisation, at the price the cart charges', () => {
      expect(productBlock['@type']).toBe('Product');
      expect(productBlock['brand']).toEqual({ '@type': 'Brand', name: 'Ojas' });
      expect(productBlock['alternateName']).toEqual(['मोदक पीठ', 'Modak Peeth']);
      expect(productBlock['offers']).toEqual(
        jasmine.objectContaining({
          '@type': 'Offer',
          url: `${SITE_URL}/products/modak-pith`,
          priceCurrency: 'INR',
          price: '65.00',
          availability: 'https://schema.org/InStock',
          seller: { '@id': ORGANIZATION_ID },
        }),
      );
    });

    it('gives every photo an absolute address', () => {
      expect(productBlock['image']).toEqual([
        `${SITE_URL}/images/modak-pith-front.webp?v=20260907`,
        `${SITE_URL}/images/modak-pith-back.webp?v=20260907`,
      ]);
    });

    it('leaves out an inline photo, which has no address to give', () => {
      const [block] = productJsonLd(product({ imageUrl: 'data:image/webp;base64,AAAA' })) as Block[];
      expect(block['image']).toEqual([`${SITE_URL}/images/modak-pith-back.webp?v=20260907`]);
    });

    it('reports a tracked product at zero as out of stock', () => {
      const [block] = productJsonLd(product({ stockQuantity: 0 })) as Block[];
      expect(block['offers'].availability).toBe('https://schema.org/OutOfStock');
    });

    it('reports a product switched off in the admin console as out of stock', () => {
      const [block] = productJsonLd(product({ isAvailable: false })) as Block[];
      expect(block['offers'].availability).toBe('https://schema.org/OutOfStock');
    });

    it('draws the same breadcrumb as the page: Home › Products › aisle › product', () => {
      expect(breadcrumb['@type']).toBe('BreadcrumbList');
      expect(breadcrumb['itemListElement'].map((c: Block) => c['name'])).toEqual([
        'Home',
        'Products',
        'Traditional & Festive',
        'Modak Pith',
      ]);
      expect(breadcrumb['itemListElement'][2].item).toBe(
        `${SITE_URL}/products?category=Traditional%20%26%20Festive`,
      );
    });

    it('has no shipping claim — Google cannot describe a Pune-only delivery area', () => {
      expect(JSON.stringify(productBlock)).not.toContain('shippingDetails');
    });
  });

  describe('productPageSeo', () => {
    it("is indexed under the product's readable address, with its pack shot as the preview", () => {
      const seo = productPageSeo(product());

      expect(seo.canonicalPath).toBe('/products/modak-pith');
      expect(seo.image).toBe(`${SITE_URL}/images/modak-pith-front.webp?v=20260907`);
      expect(seo.type).toBe('product');
      expect(seo.noindex).toBeFalsy();
    });
  });

  describe('the products page', () => {
    it("is indexed per aisle, under the aisle's own address", () => {
      const seo = productsPageSeo('Traditional & Festive', '');

      expect(seo.title).toContain('Modak Peeth');
      expect(seo.canonicalPath).toBe('/products?category=Traditional%20%26%20Festive');
      expect(seo.noindex).toBeFalse();
    });

    it('treats an aisle it does not know as the whole shop', () => {
      expect(productsPageSeo('Powder Box', '').canonicalPath).toBe('/products');
    });

    it('keeps search results out of the index', () => {
      expect(productsPageSeo('All', 'jowar').noindex).toBeTrue();
    });
  });

  it('formatWeight spaces the unit and leaves anything unusual alone', () => {
    expect(formatWeight('500g')).toBe('500 g');
    expect(formatWeight('1kg')).toBe('1 kg');
    expect(formatWeight('Pack of 2')).toBe('Pack of 2');
  });
});
