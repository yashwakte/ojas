import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { CampaignBannerService } from '../../services/campaign-banner.service';
import { CampaignBannerConfig, Product, ProductReview } from '../../models/interfaces';
import { ReviewService } from '../../services/review.service';
import {
  PRODUCT_CATEGORY_DETAILS,
  ProductCategory,
  ProductCategoryDetail,
  normalizeCategory,
} from '../../constants/product-categories';
import { ProductCard } from '../../components/product-card/product-card';
import { ScrollRevealDirective } from '../../directives/scroll-reveal.directive';
import { RevealWordsDirective } from '../../directives/reveal-words.directive';
import { CoverflowDirective } from '../../directives/coverflow.directive';
import { CampaignBanner } from '../../components/campaign-banner/campaign-banner';
import { HomeHero } from '../../components/home-hero/home-hero';
import { HomeStory } from '../../components/home-story/home-story';
import { SeasonRail } from '../../components/season-rail/season-rail';
import { HomeRibbon } from '../../components/home-ribbon/home-ribbon';
import { SEASONS, Season } from '../../constants/seasons';

/**
 * A line of Marathi over each aisle: what the aisle is *for*, in the words a customer here uses
 * for it ("for the everyday bhakri", "for fasting days", "for everyday nourishment" - never
 * "for breakfast": that aisle is eaten at any meal). The English name underneath carries
 * the meaning for everyone else.
 */
const AISLE_KICKERS: Record<ProductCategory, string> = {
  'Everyday Flours': 'रोजच्या भाकरीसाठी',
  'Traditional & Festive': 'सणासुदीसाठी',
  Upwas: 'उपवासासाठी',
  'Health & Nutrition': 'रोजच्या पोषणासाठी',
  'Baking & Desserts': 'गोडधोडासाठी',
  'Spices & Essentials': 'रोजच्या स्वयंपाकासाठी',
};

/** Rotated through so a run of aisles reads as a sequence of rooms, not one repeated strip. */
const AISLE_TONES = ['cream', 'sage', 'rose'] as const;

export interface HomeAisle extends ProductCategoryDetail {
  kicker: string;
  products: Product[];
  /** "01", "02"… - the aisle's place on the page. */
  number: string;
  tone: (typeof AISLE_TONES)[number];
}

/** One card on the home page's review wall. */
interface WallCard {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  productName: string;
  productLink: string[];
  /** When a customer posted it, as an ISO string, and as the card shows it. Null on the owner's
   * starter testimonials. */
  createdAt: string | null;
  when?: string;
}

/**
 * "21 Sept 2026, 6:42 pm". The browser's own formatter rather than Angular's DatePipe: importing
 * the pipe here pulled about 47 kB into the first download of every page, which this one line
 * does not need.
 */
const WALL_TIME = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function reviewTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : WALL_TIME.format(date);
}

/** The wall always shows at least this many cards. */
const MIN_WALL_CARDS = 3;

/**
 * Testimonials the owner supplied on 2026-09-23 for the wall until customers' own reviews
 * arrive; each one drops off as a real review takes its place. The names are the owner's.
 * The words are placeholders - replace them with what each person actually said.
 */
const STARTER_TESTIMONIALS: WallCard[] = [
  {
    id: 'starter-sneha',
    authorName: 'Sneha Dhoran',
    rating: 5,
    comment:
      'The modak pith is so fine and smooth - the ukadiche modak came out soft and did not crack once. It tastes just like home.',
    productName: 'Modak Pith',
    productLink: ['/products', 'modak-pith'],
    createdAt: null,
  },
  {
    id: 'starter-shubham',
    authorName: 'Shubham Wakte',
    rating: 5,
    comment:
      'Upvas bhajani with the right roast and aroma. The thalipeeth were crisp outside and soft inside - our fasting days are sorted.',
    productName: 'Upvas Bhajani',
    productLink: ['/products', 'upvas-bhajani'],
    createdAt: null,
  },
  {
    id: 'starter-shraddha',
    authorName: 'Shraddha Sharma',
    rating: 5,
    comment:
      'Fresh, stone-ground and neatly packed. The ragi flour makes lovely soft bhakri, and delivery was quick.',
    productName: 'Ragi Flour',
    productLink: ['/products', 'ragi-flour'],
    createdAt: null,
  },
];

@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    MatIconModule,
    ProductCard,
    ScrollRevealDirective,
    RevealWordsDirective,
    CoverflowDirective,
    CampaignBanner,
    HomeHero,
    HomeStory,
    SeasonRail,
    HomeRibbon,
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private checkoutService = inject(CheckoutService);
  private router = inject(Router);
  private campaignBannerService = inject(CampaignBannerService);
  private reviewService = inject(ReviewService);

  justAdded = signal<string | null>(null);

  // Every active campaign renders as its own banner + featured-products row,
  // stacked in the order they were created (oldest first).
  readonly activeCampaigns = computed(() =>
    this.campaignBannerService.campaigns().filter((c) => c.isActive),
  );

  featuredProductsFor(campaign: CampaignBannerConfig): Product[] {
    const ids = campaign.featuredProductIds ?? [];
    if (ids.length === 0) return [];
    const products = this.productService.products();
    return ids
      .map((id) => products.find((p) => p.id === id))
      .filter((p): p is Product => !!p && p.isAvailable);
  }

  readonly bestsellers = signal<Product[]>([]);
  readonly bestsellersLoading = signal(true);

  readonly festiveSavings = computed(() =>
    this.productService
      .products()
      .filter((p) => p.discount > 0 && p.isAvailable)
      .slice(0, 8),
  );

  /** Only the aisles with something in them - see ProductService.categoriesInUse. */
  readonly categoryTiles = computed(() => {
    const inUse = new Set<string>(this.productService.categoriesInUse());
    return PRODUCT_CATEGORY_DETAILS.filter((c) => inUse.has(c.name));
  });

  /**
   * One section per aisle, in shop order, each with its own products. These replace the two
   * rows that used to stand in for the catalogue - "Everyday Essentials" and "Upwas Specials" -
   * which between them left four aisles with no presence on the home page at all. An aisle with
   * nothing available today is left out rather than shown empty.
   */
  readonly aisles = computed<HomeAisle[]>(() => {
    const available = this.productService.products().filter((p) => p.isAvailable);
    return this.categoryTiles()
      .map((category) => ({
        ...category,
        kicker: AISLE_KICKERS[category.name],
        products: available.filter((p) => normalizeCategory(p.category) === category.name).slice(0, 8),
      }))
      .filter((aisle) => aisle.products.length > 0)
      .map((aisle, index) => ({
        ...aisle,
        number: String(index + 1).padStart(2, '0'),
        tone: AISLE_TONES[index % AISLE_TONES.length],
      }));
  });

  /** The festival calendar, minus any festival whose aisle has nothing in it - every card is a
   * link, and a link to an empty aisle is a dead end. */
  readonly seasons = computed<Season[]>(() => {
    const inUse = new Set<string>(this.productService.categoriesInUse());
    return SEASONS.filter((s) => inUse.has(s.category));
  });

  /** The ribbon above the closing call to action. */
  readonly ribbonWords = [
    'Stone-ground on a chakki',
    'शुद्ध आहार · शुद्ध विचार',
    'From a farming family',
    'Upwas-ready flours',
    'Rooted in Pune',
    'Delivered in 1–2 days',
  ];

  ngOnInit(): void {
    this.productService.getBestsellers(6).subscribe({
      next: (products) => {
        this.bestsellers.set(products);
        this.bestsellersLoading.set(false);
      },
      error: () => this.bestsellersLoading.set(false),
    });

    // Quiet on failure: the wall is simply left out, as it is before any reviews exist.
    this.reviewService.featured().subscribe({
      next: (reviews) => this.liveReviews.set(reviews),
      error: () => {},
    });
  }

  addToCart(product: Product): void {
    this.cartService.addToCart(product);
    this.justAdded.set(product.id);
    setTimeout(() => this.justAdded.set(null), 2000);
  }

  // Guests are allowed through — /checkout's auth guard collects the login and
  // sends them straight back, with the item still in their basket.
  buyNow(product: Product): void {
    this.checkoutService.addItem(product);
    this.router.navigate(['/checkout']);
  }

  features = [
    {
      icon: 'verified',
      title: '100% Pure',
      desc: "Zero additives. Zero preservatives. Just nature's finest.",
    },
    {
      icon: 'eco',
      title: 'Stone-Ground',
      desc: 'Traditional chakki process preserving nutrition & taste.',
    },
    {
      icon: 'local_shipping',
      title: 'Farm Fresh',
      desc: 'Packed fresh and delivered straight to your door.',
    },
    {
      icon: 'favorite',
      title: 'Made with Love',
      desc: 'Crafted with care by families who believe in quality.',
    },
  ];

  processSteps = [
    {
      icon: 'agriculture',
      title: 'Sourced',
      desc: 'Finest grains from trusted local farms in Maharashtra',
    },
    {
      icon: 'settings',
      title: 'Stone-Ground',
      desc: 'Traditional chakki-ground for authentic taste & nutrition',
    },
    {
      icon: 'inventory_2',
      title: 'Packed Fresh',
      desc: 'Hygienically packed the same day for maximum freshness',
    },
    { icon: 'home', title: 'Delivered', desc: 'Straight to your doorstep with care and speed' },
  ];

  /** Verified-purchase reviews from the API, newest first. */
  private readonly liveReviews = signal<ProductReview[]>([]);

  /**
   * The "Loved by Families" wall: customers' own reviews first, newest first, each with its date
   * and time, then the owner's starter testimonials until there are at least three cards.
   * The starters carry no "verified" mark and no date - they are not reviews from the shop.
   */
  readonly wall = computed<WallCard[]>(() => {
    const live: WallCard[] = this.liveReviews().map((r) => ({
      id: r.id,
      authorName: r.authorName,
      rating: r.rating,
      comment: r.comment,
      productName: r.productName,
      productLink: ['/products', r.productId],
      createdAt: r.createdAt,
      when: reviewTime(r.createdAt),
    }));
    const needed = Math.max(0, MIN_WALL_CARDS - live.length);
    return [...live, ...STARTER_TESTIMONIALS.slice(0, needed)];
  });
}
