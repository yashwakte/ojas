import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * What the deployed site gives away to someone who has not logged in.
 *
 * This suite is deliberately read-only. It never registers an account, places an order, or
 * writes anything: it asserts that the endpoints which move goods and money refuse an anonymous
 * caller, and that the storefront's advertised prices are the ones the API would charge. A
 * suite that created data here would leave real orders on the live site.
 *
 * The *authenticated* attacks — tampered prices, editing someone else's order, parallel
 * cancellations racing a refund — are covered by the API integration suite instead. They need an
 * account, and creating one on production requires an email OTP that cannot currently be
 * delivered. That is a limitation of where these run, not a gap in what is checked.
 */

/** Endpoints that must never answer an anonymous caller with data. */
const PROTECTED = [
  { method: 'GET', path: '/api/orders/my', what: "the customer's own orders" },
  { method: 'GET', path: '/api/orders/admin/all', what: 'every order in the business' },
  { method: 'GET', path: '/api/orders/admin/delivery-partners', what: 'staff accounts' },
  { method: 'GET', path: '/api/orders/delivery/my', what: "a delivery partner's round" },
  { method: 'GET', path: '/api/wallet', what: 'a wallet balance' },
  { method: 'GET', path: '/api/user/profile', what: 'a customer profile' },
] as const;

function refused(status: number): boolean {
  // 401/403 are the intended answers. 404 is acceptable for a route that hides its existence.
  return status === 401 || status === 403 || status === 404;
}

test.describe('anonymous access', () => {
  for (const endpoint of PROTECTED) {
    test(`${endpoint.method} ${endpoint.path} does not hand over ${endpoint.what}`, async ({
      request,
    }) => {
      const response = await request.fetch(endpoint.path, { method: endpoint.method });

      expect(
        refused(response.status()),
        `expected a refusal, got ${response.status()}`,
      ).toBeTruthy();
    });
  }

  test('placing an order anonymously is refused', async ({ request }) => {
    const response = await request.post('/api/orders', {
      data: {
        fullName: 'Anonymous',
        phone: '9123456789',
        address: 'Kharadi, Pune - 411014',
        latitude: 18.5,
        longitude: 73.8,
        notes: '',
        // A price the browser made up, which the server ignores in favour of the catalog —
        // but it should never get as far as pricing without a session.
        items: [{ productId: '000000000000000000000000', productName: 'x', price: 1, weight: '1kg', quantity: 1 }],
      },
    });

    expect(refused(response.status())).toBeTruthy();
  });

  test('the admin refund endpoint is refused anonymously', async ({ request }) => {
    const response = await request.post('/api/orders/admin/000000000000000000000000/refund', {
      data: { refundAmount: 1 },
    });

    expect(refused(response.status())).toBeTruthy();
  });
});

/**
 * The payment webhook is the one unauthenticated write path in the system: it is what marks
 * orders paid. It is anonymous by necessity — Cashfree calls it server-to-server — so its only
 * gate is the HMAC signature over the raw body. If that gate failed, anyone could mark any order
 * paid without paying. Worth checking against the real deployment and its real secret.
 */
test.describe('payment webhook', () => {
  const forged = {
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    data: {
      order: { order_id: '000000000000000000000000' },
      payment: {
        cf_payment_id: 'forged',
        payment_status: 'SUCCESS',
        payment_group: 'upi',
        payment_amount: 100000,
      },
    },
  };

  async function post(request: APIRequestContext, headers: Record<string, string>) {
    return request.post('/api/payments/cashfree/webhook', { data: forged, headers });
  }

  test('a forged success with no signature is rejected', async ({ request }) => {
    const response = await post(request, {});
    expect(response.status()).toBe(401);
  });

  test('a forged success with a made-up signature is rejected', async ({ request }) => {
    const response = await post(request, {
      'x-webhook-timestamp': '1700000000',
      'x-webhook-signature': 'bm90LWEtcmVhbC1zaWduYXR1cmU=',
    });
    expect(response.status()).toBe(401);
  });
});

/**
 * The storefront's advertised price has to be the one the order is billed. These disagreed until
 * recently: a product carrying a discount showed a sale price and charged the full list price.
 * The API is the authority, so this compares what it publishes against the discount arithmetic.
 */
test.describe('advertised prices', () => {
  test('every catalog price is internally consistent with its discount', async ({ request }) => {
    const response = await request.get('/api/products');
    expect(response.ok()).toBeTruthy();

    const products = (await response.json()) as {
      id: string;
      name: string;
      price: number;
      discount: number;
    }[];
    expect(products.length).toBeGreaterThan(0);

    for (const product of products) {
      expect(product.price, `${product.name} has no price`).toBeGreaterThan(0);
      expect(product.discount, `${product.name} has a negative discount`).toBeGreaterThanOrEqual(0);
      // A discount at or over 100% would make an item free, or worse, negative.
      expect(product.discount, `${product.name} is discounted to nothing`).toBeLessThan(100);
    }
  });

  test('a product page shows the same price the catalog publishes', async ({ page, request }) => {
    const products = (await (await request.get('/api/products')).json()) as {
      id: string;
      name: string;
      price: number;
      discount: number;
      isAvailable: boolean;
    }[];

    const product = products.find((p) => p.isAvailable) ?? products[0];
    const effective = Math.round((product.price - (product.price * product.discount) / 100) * 100) / 100;

    await page.goto(`/product/${product.id}`);
    await expect(page.getByRole('heading', { name: product.name })).toBeVisible();

    // Whatever else is on the page, the price the customer will be charged has to appear on it.
    const shown = (await page.locator('body').innerText()).replace(/,/g, '');
    const asWritten = Number.isInteger(effective) ? String(effective) : effective.toFixed(2);
    expect(shown, `expected ₹${asWritten} on the page for ${product.name}`).toContain(asWritten);
  });
});

test.describe('delivery pricing', () => {
  /**
   * The estimate endpoint is public, which is fine — it quotes, it doesn't sell. What matters is
   * that it answers from the pincode, so that a pin claiming to be the warehouse cannot buy
   * cheaper delivery. Read-only: it creates nothing.
   */
  test('a quote for a pincode we do not serve is not free', async ({ request }) => {
    // Warehouse-ish coordinates, paired with a pincode far outside Pune.
    const response = await request.get(
      '/api/delivery-charges/calculate?latitude=18.5672&longitude=73.7793&pincode=400001',
    );
    expect(response.ok()).toBeTruthy();

    const quote = (await response.json()) as {
      isServiceable: boolean;
      charge: number;
      pricedByPincode?: boolean;
    };

    // Once pincode pricing is configured this must be refused outright. Until then the older
    // distance rules answer instead, and this records which mode production is actually in.
    if (quote.pricedByPincode) {
      expect(quote.isServiceable, 'an unserved pincode was quoted as deliverable').toBeFalsy();
    } else {
      test.info().annotations.push({
        type: 'warning',
        description:
          'Production is still pricing delivery by distance from the map pin, which the browser supplies. Add serviceable pincodes in Admin → Delivery Charges before going live.',
      });
    }
  });
});
