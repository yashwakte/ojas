import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { CampaignBannerManagement } from './campaign-banner-management';
import { CampaignBannerService } from '../../services/campaign-banner.service';
import { ProductService } from '../../services/product.service';
import { CampaignBannerConfig, Product } from '../../models/interfaces';
import { MediaUploadService, UploadedImage } from '../../services/media-upload.service';

describe('CampaignBannerManagement', () => {
  const config: CampaignBannerConfig = {
    id: 'b1',
    title: 'Festive Sale',
    subtitle: 'Save big',
    ctaText: 'Shop Now',
    ctaLink: '/products',
    backgroundImageUrl: '',
    isActive: true,
    featuredSectionTitle: 'This Campaign',
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
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: '',
    benefits: '',
    storageInfo: '',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
  const product2: Product = { ...product, id: 'p2', name: 'Ragi Flour' };

  let campaignsSignal: ReturnType<typeof signal<CampaignBannerConfig[]>>;
  let campaignBannerServiceSpy: any;
  let productServiceSpy: any;
  let mediaUploadSpy: jasmine.SpyObj<MediaUploadService>;

  beforeEach(() => {
    campaignsSignal = signal<CampaignBannerConfig[]>([]);
    campaignBannerServiceSpy = jasmine.createSpyObj(
      'CampaignBannerService',
      ['loadCampaigns', 'createCampaign', 'updateCampaign', 'deleteCampaign'],
      {
        campaigns: campaignsSignal,
        loading: signal(false),
      },
    );
    productServiceSpy = { products: signal<Product[]>([product, product2]) };

    mediaUploadSpy = jasmine.createSpyObj<MediaUploadService>('MediaUploadService', ['upload', 'validate']);
    mediaUploadSpy.validate.and.returnValue(null);
    mediaUploadSpy.upload.and.returnValue(
      of<UploadedImage>({ url: '/api/media/abc.webp', width: 1600, height: 900 }),
    );

    TestBed.configureTestingModule({
      imports: [CampaignBannerManagement],
      providers: [
        { provide: CampaignBannerService, useValue: campaignBannerServiceSpy },
        { provide: ProductService, useValue: productServiceSpy },
        { provide: MediaUploadService, useValue: mediaUploadSpy },
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

  it('calls loadCampaigns on init and starts in list view', () => {
    const { fixture } = create();
    expect(campaignBannerServiceSpy.loadCampaigns).toHaveBeenCalled();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.editingId()).toBeNull();
  });

  it('startCreate resets the form and enters create mode', () => {
    const { fixture } = create();
    fixture.componentInstance.startCreate();

    expect(fixture.componentInstance.editingId()).toBe('new');
    expect(fixture.componentInstance.formData().title).toBe('');
    expect(fixture.componentInstance.formData().featuredSectionTitle).toBe('This Campaign');
  });

  it('startEdit loads the given campaign into the form and enters edit mode', () => {
    const { fixture } = create();
    fixture.componentInstance.startEdit(config);

    expect(fixture.componentInstance.editingId()).toBe('b1');
    expect(fixture.componentInstance.formData()).toEqual({
      title: 'Festive Sale',
      subtitle: 'Save big',
      ctaText: 'Shop Now',
      ctaLink: '/products',
      backgroundImageUrl: '',
      isActive: true,
      featuredSectionTitle: 'This Campaign',
      featuredProductIds: ['p1'],
      fallbackBestsellerProductIds: [],
    });
  });

  it('cancelForm returns to the list view', () => {
    const { fixture } = create();
    fixture.componentInstance.startCreate();
    fixture.componentInstance.cancelForm();

    expect(fixture.componentInstance.editingId()).toBeNull();
  });

  it('filteredProducts filters by search term (case-insensitive)', () => {
    const { fixture } = create();
    fixture.componentInstance.productSearch.set('ragi');
    expect(fixture.componentInstance.filteredProducts()).toEqual([product2]);
  });

  it('isFeatured / toggleFeatured toggle a product id in featuredProductIds', () => {
    const { fixture } = create();
    fixture.componentInstance.startCreate();
    expect(fixture.componentInstance.isFeatured('p1')).toBeFalse();
    fixture.componentInstance.toggleFeatured('p1');
    expect(fixture.componentInstance.isFeatured('p1')).toBeTrue();
    fixture.componentInstance.toggleFeatured('p1');
    expect(fixture.componentInstance.isFeatured('p1')).toBeFalse();
  });

  it('isFallbackBestseller / toggleFallbackBestseller toggle a product id', () => {
    const { fixture } = create();
    fixture.componentInstance.startCreate();
    expect(fixture.componentInstance.isFallbackBestseller('p2')).toBeFalse();
    fixture.componentInstance.toggleFallbackBestseller('p2');
    expect(fixture.componentInstance.isFallbackBestseller('p2')).toBeTrue();
  });

  // Title and subtitle are both optional: festival artwork usually carries its own headline and
  // a second one laid over the picture looked like a mistake. A campaign is allowed to be
  // nothing but its image and its button.
  it('validateForm accepts an empty title and subtitle', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.set({ title: '', subtitle: '' });
    expect(fixture.componentInstance.validateForm()).toBeTrue();
    expect(fixture.componentInstance.hasError('title')).toBeFalse();
  });

  it('validateForm caps the title at 100 characters and the subtitle at 200', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.set({ title: 'a'.repeat(101), subtitle: '' });
    expect(fixture.componentInstance.validateForm()).toBeFalse();
    expect(fixture.componentInstance.hasError('title')).toBeTrue();

    fixture.componentInstance.formData.set({ title: 'Valid', subtitle: 'a'.repeat(201) });
    expect(fixture.componentInstance.validateForm()).toBeFalse();
    expect(fixture.componentInstance.hasError('subtitle')).toBeTrue();

    fixture.componentInstance.formData.set({ title: 'Valid', subtitle: 'ok' });
    expect(fixture.componentInstance.validateForm()).toBeTrue();
  });

  it('saveConfig shows an error and skips the service call when the form is invalid', () => {
    const { fixture, snackBar } = create();
    fixture.componentInstance.startCreate();
    fixture.componentInstance.formData.set({ title: 'a'.repeat(101) });

    fixture.componentInstance.saveConfig();

    expect(snackBar.open).toHaveBeenCalledWith('Please fix the validation errors', 'Close', jasmine.any(Object));
    expect(campaignBannerServiceSpy.createCampaign).not.toHaveBeenCalled();
  });

  it('onBackgroundImageSelected uploads the picture and keeps only the URL', () => {
    const { fixture } = create();
    fixture.componentInstance.startCreate();
    const file = new File(['artwork'], 'janmashtami.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    fixture.componentInstance.onBackgroundImageSelected({ target: input } as unknown as Event);

    expect(mediaUploadSpy.upload).toHaveBeenCalledWith(file, 'banner');
    expect(fixture.componentInstance.formData().backgroundImageUrl).toBe('/api/media/abc.webp');
    expect(fixture.componentInstance.uploadingImage()).toBeFalse();
  });

  it('onBackgroundImageSelected leaves the existing image alone when the upload fails', () => {
    const { fixture, snackBar } = create();
    fixture.componentInstance.startCreate();
    fixture.componentInstance.formData.update((d) => ({ ...d, backgroundImageUrl: '/api/media/old.webp' }));
    mediaUploadSpy.upload.and.returnValue(throwError(() => ({ error: { message: 'Upload rejected' } })));
    const file = new File(['artwork'], 'janmashtami.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    fixture.componentInstance.onBackgroundImageSelected({ target: input } as unknown as Event);

    expect(snackBar.open).toHaveBeenCalledWith('Upload rejected', 'Close', jasmine.any(Object));
    expect(fixture.componentInstance.formData().backgroundImageUrl).toBe('/api/media/old.webp');
    expect(fixture.componentInstance.uploadingImage()).toBeFalse();
  });

  it('saveConfig calls createCampaign and shows a success message when creating', () => {
    campaignBannerServiceSpy.createCampaign.and.returnValue(of(config));
    const { fixture, snackBar } = create();
    fixture.componentInstance.startCreate();
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

    expect(campaignBannerServiceSpy.createCampaign).toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'Campaign created successfully',
      'Close',
      jasmine.any(Object),
    );
    expect(fixture.componentInstance.submitting()).toBeFalse();
    expect(fixture.componentInstance.editingId()).toBeNull();
  });

  it('saveConfig calls updateCampaign with the campaign id when editing', () => {
    campaignBannerServiceSpy.updateCampaign.and.returnValue(of(config));
    const { fixture } = create();
    fixture.componentInstance.startEdit(config);

    fixture.componentInstance.saveConfig();

    expect(campaignBannerServiceSpy.updateCampaign).toHaveBeenCalledWith('b1', jasmine.any(Object));
  });

  it('saveConfig shows an error message when the save fails', () => {
    campaignBannerServiceSpy.createCampaign.and.returnValue(
      throwError(() => ({ error: { message: 'Server error' } })),
    );
    const { fixture, snackBar } = create();
    fixture.componentInstance.startCreate();
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

  it('deleteCampaign does nothing when the confirmation is declined', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    const { fixture } = create();

    fixture.componentInstance.deleteCampaign(config);

    expect(campaignBannerServiceSpy.deleteCampaign).not.toHaveBeenCalled();
  });

  it('deleteCampaign calls the service and shows a success message when confirmed', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    campaignBannerServiceSpy.deleteCampaign.and.returnValue(of(undefined));
    const { fixture, snackBar } = create();

    fixture.componentInstance.deleteCampaign(config);

    expect(campaignBannerServiceSpy.deleteCampaign).toHaveBeenCalledWith('b1');
    expect(snackBar.open).toHaveBeenCalledWith('Campaign deleted', 'Close', jasmine.any(Object));
  });

  it('deleteCampaign shows an error message when the delete fails', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    campaignBannerServiceSpy.deleteCampaign.and.returnValue(
      throwError(() => ({ error: { message: 'Cannot delete' } })),
    );
    const { fixture, snackBar } = create();

    fixture.componentInstance.deleteCampaign(config);

    expect(snackBar.open).toHaveBeenCalledWith('Cannot delete', 'Close', jasmine.any(Object));
  });
});
