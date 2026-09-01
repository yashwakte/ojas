/**
 * Content for the four policy pages Ojas is legally and commercially required to publish.
 *
 * These exist for two audiences at once: customers, and the payment gateway's compliance review -
 * Cashfree will not whitelist a domain for live payments unless Contact, Terms, and Refunds and
 * Cancellations are all reachable on it. Everything written here must therefore match what the
 * software actually does; a policy that promises something the code does not honour is worse than
 * no policy at all. Where a rule is stated below there is a corresponding enforcement in the API
 * (see OrderCancellationService, OrdersController.RejectReductions and the wallet ledger).
 */

export interface LegalSection {
  heading: string;
  /** Rendered as ordinary prose paragraphs, in order, before any bullets. */
  paragraphs?: string[];
  bullets?: string[];
  /** A closing paragraph rendered *after* the bullets - for a caveat that only makes sense once
   * the reader has seen the list it qualifies. */
  footnote?: string;
}

export interface LegalDocument {
  slug: string;
  /** Browser tab / page heading. */
  title: string;
  /** One or two sentences under the heading, before the numbered sections. */
  intro: string;
  sections: LegalSection[];
}

/** Shown on every policy page. Bump this whenever the substance of a policy changes - not for
 * typo fixes, since a moved date implies to a returning customer that the terms changed. */
export const POLICY_LAST_UPDATED = '1 September 2026';

const BUSINESS_NAME = 'Asha Marketing';
const SUPPORT_EMAIL = 'wecare@ojasaata.com';
const SUPPORT_PHONE = '+91 8657781526';
const REGISTERED_ADDRESS =
  'Near Chhatrapati Shivaji Maharaj Udyan, Madhuban Society Lane No. 9, Old Sanghvi, Pune – 411027, Maharashtra, India';

const contact: LegalDocument = {
  slug: 'contact',
  title: 'Contact Us',
  intro:
    `Ojas is a brand owned and operated by ${BUSINESS_NAME}. If you have a question about an ` +
    'order, a product, a refund or anything else, a real person will answer you.',
  sections: [
    {
      heading: 'Reach us directly',
      bullets: [
        `Phone: ${SUPPORT_PHONE}`,
        `Email: ${SUPPORT_EMAIL}`,
        'Hours: Monday to Saturday, 9:00am – 7:00pm IST',
      ],
    },
    {
      heading: 'Registered business address',
      paragraphs: [`${BUSINESS_NAME}`, REGISTERED_ADDRESS],
    },
    {
      heading: 'About the business',
      paragraphs: [
        `${BUSINESS_NAME} is a licensed food business under FSSAI, covering the manufacture and ` +
          'packing of every product sold on this site. The licence number is printed on each pack.',
        'When you place an order on this site, ' +
          `${BUSINESS_NAME} is the business you are buying from and the business accountable to you.`,
      ],
    },
    {
      heading: 'Questions about a specific order',
      paragraphs: [
        'The fastest route is to open My Orders while signed in — every order there shows its ' +
          'current status, what was paid, and what has been refunded, if anything. If something ' +
          'still looks wrong, call or email us with the order number and we will sort it out.',
      ],
    },
  ],
};

const terms: LegalDocument = {
  slug: 'terms',
  title: 'Terms and Conditions',
  intro:
    `These terms govern your use of this website and any order you place on it. The site is ` +
    `operated by ${BUSINESS_NAME} ("we", "us"), Pune, Maharashtra, India. By placing an order you ` +
    'accept these terms.',
  sections: [
    {
      heading: '1. Who we are',
      paragraphs: [
        `Ojas is a brand owned and operated by ${BUSINESS_NAME}, whose registered address is ` +
          `${REGISTERED_ADDRESS}. ${BUSINESS_NAME} is a licensed food business under FSSAI.`,
      ],
    },
    {
      heading: '2. Your account',
      paragraphs: [
        'You need an account to place an order. You must give a mobile number you control, which ' +
          'we verify with a one-time code, and an email address we can reach you on. You are ' +
          'responsible for keeping your password confidential and for activity under your account.',
        'Please keep your delivery address and contact details accurate — we use them to deliver ' +
          'your order and to reach you if there is a problem with it.',
      ],
    },
    {
      heading: '3. Products, pricing and availability',
      paragraphs: [
        'All prices are in Indian Rupees and include applicable taxes unless stated otherwise on ' +
          'the product page. Prices and offers can change at any time, but the price that applies ' +
          'to your order is the price shown when you place it.',
        'Product images are illustrative. Because our products are milled and packed in batches, ' +
          'minor variation in colour, texture and appearance between batches is normal and is not ' +
          'a defect.',
        'We may limit or decline an order where stock has run out or where an item was listed at ' +
          'a clearly incorrect price. If we do, and you have already paid, you get a full refund.',
      ],
    },
    {
      heading: '4. Orders and payment',
      paragraphs: [
        'Orders are paid for online. We do not offer cash on delivery. Payments are processed by ' +
          'Cashfree Payments; we never see or store your full card details.',
        'An order is confirmed only once payment has been confirmed by the payment gateway. If a ' +
          'payment fails or is abandoned, nothing is charged, the items stay in your cart, and the ' +
          'order does not stand.',
      ],
    },
    {
      heading: '5. Changing an order',
      paragraphs: [
        'You can add items to an order any time before it is packed. Where that raises the total, ' +
          'the difference is collected online before the change takes effect — until that payment ' +
          'is confirmed, your order stays exactly as it was.',
        'Items cannot be removed from a placed order. If you no longer want what you ordered, ' +
          'cancel the order instead and place a fresh one.',
      ],
    },
    {
      heading: '6. Delivery',
      paragraphs: [
        'We deliver within our serviceable pincodes in and around Pune. The pincode on your ' +
          'delivery address decides both whether we can deliver and what the delivery charge is; ' +
          'both are shown to you before you pay.',
        'Estimated delivery is 1–2 days from the time the order is placed. That is an estimate ' +
          'made in good faith, not a guarantee — weather, traffic and supply can delay it, and we ' +
          'will tell you if it does.',
        'Please check your order at the door. You may refuse anything you are not happy with at ' +
          'that moment, at no cost to you.',
      ],
    },
    {
      heading: '7. Cancellations and refunds',
      paragraphs: [
        'Cancellations and refunds are covered in full by our Refunds and Cancellations policy, ' +
          'which forms part of these terms.',
      ],
    },
    {
      heading: '8. Ojas wallet',
      paragraphs: [
        'Refunds may be credited to an Ojas wallet held against your account. Wallet credit can be ' +
          'spent only on this site. It cannot be transferred to another person and cannot be ' +
          'withdrawn to a bank account or converted to cash. Wallet credit does not expire.',
        'If you want money back outside the wallet, use the refund-to-original-payment-method ' +
          'option described in the Refunds and Cancellations policy.',
      ],
    },
    {
      heading: '9. Acceptable use',
      paragraphs: [
        'Please do not attempt to interfere with the site, access other customers’ data, ' +
          'automate ordering, or use the site for anything unlawful. We may suspend an account we ' +
          'reasonably believe is being used this way.',
      ],
    },
    {
      heading: '10. Our responsibility to you',
      paragraphs: [
        'We take the quality and safety of our food seriously and we stand behind it. Nothing in ' +
          'these terms limits any right you have under the Consumer Protection Act, 2019 or the ' +
          'Food Safety and Standards Act, 2006, or excludes liability for death or personal injury ' +
          'caused by our negligence.',
        'Beyond that, our liability in connection with an order is limited to the amount you paid ' +
          'for it.',
      ],
    },
    {
      heading: '11. Governing law',
      paragraphs: [
        'These terms are governed by the laws of India, and the courts at Pune, Maharashtra have ' +
          'jurisdiction over any dispute arising from them.',
      ],
    },
    {
      heading: '12. Changes to these terms',
      paragraphs: [
        'We may update these terms from time to time. The version published here when you place ' +
          'an order is the version that applies to that order.',
      ],
    },
    {
      heading: '13. Contact',
      paragraphs: [
        `Questions about these terms: ${SUPPORT_EMAIL}, or ${SUPPORT_PHONE}, Monday to Saturday, ` +
          '9:00am – 7:00pm IST.',
      ],
    },
  ],
};

const refunds: LegalDocument = {
  slug: 'refunds',
  title: 'Refunds and Cancellations',
  intro:
    'Food is different from most things you buy online, so our policy is built around checking ' +
    'your order at the door rather than sending it back afterwards. Here is exactly how it works.',
  sections: [
    {
      heading: 'Cancelling an order',
      paragraphs: [
        'You can cancel any time before your order has been packed. Open My Orders, choose the ' +
          'order, and select Cancel. There is no cancellation fee.',
        'Once an order has been packed and handed to delivery it can no longer be cancelled from ' +
          'the site — but you can still refuse it at the door, which is treated the same way.',
      ],
    },
    {
      heading: 'Checking your order at the door',
      paragraphs: [
        'We do not operate a returns window, because we do not think it is right to take back food ' +
          'that has left our hands and been out of our sight. Instead, please open and check your ' +
          'order while the delivery person is still with you.',
        'If anything is damaged, short, wrong or simply not up to standard, refuse it there and ' +
          'then. You will not be charged for anything you refuse, and any money already taken for ' +
          'it is refunded.',
      ],
    },
    {
      heading: 'Where your refund goes',
      paragraphs: [
        'A cancelled or refused order is refunded in full, including any delivery charge you paid ' +
          'on it. Where the refund goes depends on how you paid:',
      ],
      bullets: [
        'Anything paid from your Ojas wallet always returns to your Ojas wallet, immediately.',
        'Anything paid by card, UPI or net banking can be refunded either to your Ojas wallet, ' +
          'which is immediate, or back to the original payment method.',
        'A discount applied by the payment provider at checkout is not money we received, so it ' +
          'cannot be refunded as wallet credit. Only what was actually charged is refunded.',
      ],
    },
    {
      heading: 'How long a refund takes',
      paragraphs: [
        'Refunds to your Ojas wallet are credited immediately and are visible in your wallet ' +
          'history straight away.',
        'Refunds to the original payment method are approved by us and then processed through ' +
          'Cashfree Payments. Once we release it, your bank or card issuer typically takes 5–7 ' +
          'working days to show the money in your account. That last part is outside our control.',
        'Every refund we make is recorded against the order, so you can always see on the order ' +
          'itself what was returned and where it went.',
      ],
    },
    {
      heading: 'Adding to an order',
      paragraphs: [
        'You can add items to an order before it is packed, and you pay only the difference. ' +
          'Items cannot be removed from a placed order — if you no longer want it, cancel the ' +
          'whole order and place a fresh one.',
      ],
    },
    {
      heading: 'Failed or abandoned payments',
      paragraphs: [
        'If a payment fails, or you leave the payment page without finishing, nothing is charged ' +
          'and the order does not stand. Your items stay in your cart so you can try again.',
        'If a payment reaches us after its order has already been cancelled — which can happen ' +
          'with a slow bank transfer — we credit it to your Ojas wallet rather than keeping it.',
      ],
    },
    {
      heading: 'Something still not right?',
      paragraphs: [
        `Call ${SUPPORT_PHONE} or email ${SUPPORT_EMAIL}, Monday to Saturday, 9:00am – 7:00pm ` +
          'IST, with your order number. If we have got something wrong, we will put it right.',
      ],
    },
  ],
};

const privacy: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy Policy',
  intro:
    `This policy explains what personal information ${BUSINESS_NAME} collects when you use this ` +
    'site, why we collect it, and who else sees it. We collect as little as we can, and we do not ' +
    'sell it to anyone.',
  sections: [
    {
      heading: 'What we collect',
      bullets: [
        'Your name, mobile number and email address, so we can identify your account and reach ' +
          'you about your order.',
        'Your delivery address, including the pincode and the map location you choose, so we can ' +
          'work out whether we deliver to you, what the delivery charge is, and how to find you.',
        'Your order history, payments and wallet movements, so you and we can both see what was ' +
          'bought, paid and refunded.',
        'Basic technical information your browser sends — such as your IP address — which is used ' +
          'for security and fraud prevention.',
      ],
      footnote:
        'We never see or store your full card number, CVV or UPI PIN. Those go directly to our ' +
        'payment provider and never reach our servers.',
    },
    {
      heading: 'Why we collect it',
      paragraphs: [
        'To take and deliver your orders, to take payment and issue refunds, to verify that the ' +
          'mobile number and email on an account really belong to the person using it, to answer ' +
          'you when you contact support, to protect the site from fraud and abuse, and to meet our ' +
          'obligations as a licensed food business.',
        'We do not use your information for advertising and we do not sell or rent it to anyone.',
      ],
    },
    {
      heading: 'Who else sees it',
      paragraphs: [
        'We share the minimum necessary with the service providers that make the site work:',
      ],
      bullets: [
        'Cashfree Payments — processes your payments and refunds.',
        'MSG91 — sends the one-time code that verifies your mobile number.',
        'Resend — sends transactional email such as verification and password reset.',
        'Cloudflare — provides the security check that protects our sign-in and sign-up forms.',
        'MongoDB Atlas, Render and Vercel — host the site and its database.',
        'Our own delivery staff — see your name, address and phone number in order to deliver.',
      ],
      footnote:
        'We may also disclose information where the law requires it, or to protect our rights, ' +
        'our customers or the public.',
    },
    {
      heading: 'Cookies and your session',
      paragraphs: [
        'We use cookies that are strictly necessary to run the site: they keep you signed in and ' +
          'protect forms against cross-site request forgery. We do not use advertising or ' +
          'third-party tracking cookies.',
        'Clearing these cookies will sign you out but will not otherwise affect your account.',
      ],
    },
    {
      heading: 'How long we keep it',
      paragraphs: [
        'We keep your account and order records for as long as your account is open, and after ' +
          'that for as long as we are required to for tax, accounting and food-safety purposes.',
        'You can ask us to close your account and delete your personal information at any time. ' +
          'Where we are legally required to retain a record of a completed sale, we keep only that ' +
          'record and remove the rest.',
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'You can ask us for a copy of the personal information we hold about you, ask us to ' +
          'correct it if it is wrong, or ask us to delete it. Much of it you can see and correct ' +
          'yourself from your profile and your orders at any time.',
        `To make any of these requests, email ${SUPPORT_EMAIL} from the address on your account.`,
      ],
    },
    {
      heading: 'Keeping it safe',
      paragraphs: [
        'Traffic to and from this site is encrypted. Passwords are stored hashed, never in plain ' +
          'text. Access to customer data is limited to the people who need it to run the shop.',
        'No system is perfectly secure, but if a breach ever affected your personal information we ' +
          'would tell you.',
      ],
    },
    {
      heading: "Children's privacy",
      paragraphs: [
        'This site is not intended for children under 18, and we do not knowingly collect their ' +
          'personal information.',
      ],
    },
    {
      heading: 'Changes and contact',
      paragraphs: [
        'If we change this policy we will update the date at the top of this page.',
        `Questions about privacy: ${SUPPORT_EMAIL}, or write to ${BUSINESS_NAME}, ` +
          `${REGISTERED_ADDRESS}.`,
      ],
    },
  ],
};

/** Keyed by the `slug` on each route's data, so one component renders all four pages. */
export const LEGAL_DOCUMENTS: Record<string, LegalDocument> = {
  contact: contact,
  terms: terms,
  refunds: refunds,
  privacy: privacy,
};
