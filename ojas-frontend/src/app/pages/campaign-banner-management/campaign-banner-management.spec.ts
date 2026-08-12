import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { CampaignBannerManagement } from './campaign-banner-management';
import { CampaignBannerService } from '../../services/campaign-banner.service';
import { ProductService } from '../../services/product.service';
import { CampaignBannerConfig, Product } from '../../models/interfaces';

describe('CampaignBannerManagement', () => {
  const config: CampaignBannerConfig = {
    id: 'b1',
    title: 'Festive Sale',
    subtitle: 'Save big',
    ctaText: 'Shop Now',
    ctaLink: '/products',
    isActive: true,
    featuredProductIds: ['p1'],
    fallbackBestsellerProductIds: [],
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
  const product: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'desc',
    price: 100,
    discount: 0,
    category: 'Flour',
    imageUrl: '',
    galleryImageUrls: [],
    weight: '500g',
    isAvailable: true,
    ingredients: '',
    benefits: '',
    storageInfo: '',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
  const product2: Product = { ...product, id: 'p2', name: 'Ragi Flour' };

  let configSignal: ReturnType<typeof signal<CampaignBannerConfig | null>>;
  let campaignBannerServiceSpy: any;
  let productServiceSpy: any;

  beforeEach(() => {
    configSignal = signal<CampaignBannerConfig | null>(null);
    campaignBannerServiceSpy = jasmine.createSpyObj('CampaignBannerService', ['loadConfig', 'updateConfig'], {
      config: configSignal,
      loading: signal(false),
    });
    productServiceSpy = { products: signal<Product[]>([product, product2]) };

    TestBed.configureTestingModule({
      imports: [CampaignBannerManagement],
      providers: [
        { provide: CampaignBannerService, useValue: campaignBannerServiceSpy },
        { provide: ProductService, useValue: productServiceSpy },
      ],
    });
  });

  // MatSnackBarModule declares its own `providers: [MatSnackBar]` pulled into this standalone
  // component's own injector, shadowing a TestBed-level override - spy on the real instance.
  function create() {
    const fixture = TestBed.createComponent(CampaignBannerManagement);
    fixture.detectChanges();
    const snackBar = fixture.debugElement.injector.get(MatSnackBar);
    spyOn(snackBar, 'open').and.stub();
    return { fixture, snackBar };
  }

  it('calls loadConfig on init', () => {
    const { fixture } = create();
    expect(campaignBannerServiceSpy.loadConfig).toHaveBeenCalled();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('syncs formData from the service config whenever it changes', () => {
    const { fixture } = create();
    configSignal.set(config);
    TestBed.flushEffects();

    expect(fixture.componentInstance.formData()).toEqual({
      title: 'Festive Sale',
      subtitle: 'Save big',
      ctaText: 'Shop Now',
      ctaLink: '/products',
      isActive: true,
      featuredProductIds: ['p1'],
      fallbackBestsellerProductIds: [],
    });
  });

  it('filteredProducts filters by search term (case-insensitive)', () => {
    const { fixture } = create();
    fixture.componentInstance.productSearch.set('ragi');
    expect(fixture.componentInstance.filteredProducts()).toEqual([product2]);
  });

  it('isFeatured / toggleFeatured toggle a product id in featuredProductIds', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.isFeatured('p1')).toBeFalse();
    fixture.componentInstance.toggleFeatured('p1');
    expect(fixture.componentInstance.isFeatured('p1')).toBeTrue();
    fixture.componentInstance.toggleFeatured('p1');
    expect(fixture.componentInstance.isFeatured('p1')).toBeFalse();
  });

  it('isFallbackBestseller / toggleFallbackBestseller toggle a product id', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.isFallbackBestseller('p2')).toBeFalse();
    fixture.componentInstance.toggleFallbackBestseller('p2');
    expect(fixture.componentInstance.isFallbackBestseller('p2')).toBeTrue();
  });

  it('validateForm requires a title within 100 characters and subtitle within 200', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.set({ title: '', subtitle: '' });
    expect(fixture.componentInstance.validateForm()).toBeFalse();
    expect(fixture.componentInstance.hasError('title')).toBeTrue();

    fixture.componentInstance.formData.set({ title: 'a'.repeat(101), subtitle: '' });
    expect(fixture.componentInstance.validateForm()).toBeFalse();

    fixture.componentInstance.formData.set({ title: 'Valid', subtitle: 'a'.repeat(201) });
    expect(fixture.componentInstance.validateForm()).toBeFalse();
    expect(fixture.componentInstance.hasError('subtitle')).toBeTrue();

    fixture.componentInstance.formData.set({ title: 'Valid', subtitle: 'ok' });
    expect(fixture.componentInstance.validateForm()).toBeTrue();
  });

  it('saveConfig shows an error and skips the service call when the form is invalid', () => {
    const { fixture, snackBar } = create();
    fixture.componentInstance.formData.set({ title: '' });

    fixture.componentInstance.saveConfig();

    expect(snackBar.open).toHaveBeenCalledWith('Please fix the validation errors', 'Close', jasmine.any(Object));
    expect(campaignBannerServiceSpy.updateConfig).not.toHaveBeenCalled();
  });

  it('saveConfig updates the config and shows a success message', () => {
    campaignBannerServiceSpy.updateConfig.and.returnValue(of(config));
    const { fixture, snackBar } = create();
    fixture.componentInstance.formData.set({
      title: 'Sale',
      subtitle: 'sub',
      ctaText: 'Go',
      ctaLink: '/products',
      isActive: true,
      featuredProductIds: [],
      fallbackBestsellerProductIds: [],
    });

    fixture.componentInstance.saveConfig();

    expect(campaignBannerServiceSpy.updateConfig).toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'Campaign banner updated successfully',
      'Close',
      jasmine.any(Object),
    );
    expect(fixture.componentInstance.submitting()).toBeFalse();
  });

  it('saveConfig shows an error message when the update fails', () => {
    campaignBannerServiceSpy.updateConfig.and.returnValue(
      throwError(() => ({ error: { message: 'Server error' } })),
    );
    const { fixture, snackBar } = create();
    fixture.componentInstance.formData.set({
      title: 'Sale',
      subtitle: '',
      ctaText: '',
      ctaLink: '',
      isActive: true,
      featuredProductIds: [],
      fallbackBestsellerProductIds: [],
    });

    fixture.componentInstance.saveConfig();

    expect(snackBar.open).toHaveBeenCalledWith('Server error', 'Close', jasmine.any(Object));
    expect(fixture.componentInstance.submitting()).toBeFalse();
  });

  it('toggleActive updates isActive in the form and triggers a save', () => {
    campaignBannerServiceSpy.updateConfig.and.returnValue(of(config));
    const { fixture } = create();
    fixture.componentInstance.formData.set({
      title: 'Sale',
      subtitle: '',
      ctaText: '',
      ctaLink: '',
      isActive: false,
      featuredProductIds: [],
      fallbackBestsellerProductIds: [],
    });

    fixture.componentInstance.toggleActive({ checked: true });

    expect(fixture.componentInstance.formData().isActive).toBeTrue();
    expect(campaignBannerServiceSpy.updateConfig).toHaveBeenCalled();
  });
});
