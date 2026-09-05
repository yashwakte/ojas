import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { ProductManagement } from './product-management';
import { ProductService } from '../../services/product.service';
import { MediaUploadService, UploadedImage } from '../../services/media-upload.service';
import { Product } from '../../models/interfaces';
import { signal } from '@angular/core';

describe('ProductManagement', () => {
  const product: Product = {
    id: 'p1',
    name: 'Bajra Flour',
    description: 'A great flour',
    price: 100,
    discount: 10,
    category: 'Flour',
    imageUrl: '/images/p1.jpg',
    galleryImageUrls: [],
    weight: '500g',
    isAvailable: true,
    stockQuantity: null,
    lowStockThreshold: 5,
    ingredients: 'Bajra grains',
    benefits: 'Rich in fiber and minerals',
    storageInfo: 'Store in a cool, dry place away from sunlight',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  let productServiceSpy: any;
  let mediaUploadSpy: jasmine.SpyObj<MediaUploadService>;

  beforeEach(() => {
    productServiceSpy = jasmine.createSpyObj(
      'ProductService',
      ['loadProducts', 'createProduct', 'updateProduct', 'deleteProduct'],
      {
        products: signal<Product[]>([product]),
        loading: signal(false),
        error: signal<string | null>(null),
      },
    );

    mediaUploadSpy = jasmine.createSpyObj<MediaUploadService>('MediaUploadService', ['upload', 'validate']);
    mediaUploadSpy.validate.and.returnValue(null);
    mediaUploadSpy.upload.and.returnValue(
      of<UploadedImage>({ url: '/api/media/abc.webp', width: 800, height: 600 }),
    );

    TestBed.configureTestingModule({
      imports: [ProductManagement],
      providers: [
        { provide: ProductService, useValue: productServiceSpy },
        { provide: MediaUploadService, useValue: mediaUploadSpy },
      ],
    });
  });

  // ProductManagement imports MatSnackBarModule, which declares its own `providers: [MatSnackBar]`
  // pulled into this standalone component's own injector - a TestBed-level override is shadowed,
  // so we spy on the real, component-scoped instance instead.
  function create() {
    const fixture = TestBed.createComponent(ProductManagement);
    fixture.detectChanges();
    const snackBar = fixture.debugElement.injector.get(MatSnackBar);
    spyOn(snackBar, 'open').and.stub();
    return { fixture, snackBar };
  }

  function validFormData() {
    return {
      name: 'New Product',
      description: 'A wonderful new product description',
      price: 50,
      discount: 5,
      category: 'Grains' as const,
      imageUrl: '/images/new.jpg',
      galleryImageUrls: [],
      weight: '1kg',
      isAvailable: true,
      stockQuantity: null,
      lowStockThreshold: 5,
      ingredients: 'Some ingredients',
      benefits: 'Some benefits described here',
      storageInfo: 'Some storage info described here',
    };
  }

  it('should create and load products on init, bypassing any cached catalogue', () => {
    const { fixture } = create();
    expect(fixture.componentInstance).toBeTruthy();
    // The admin judges a save by this list, so it must not be answered from a cached copy.
    expect(productServiceSpy.loadProducts).toHaveBeenCalledWith({ bypassCache: true });
  });

  it('filteredProducts returns all when filter is All, or the matching category otherwise', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.filteredProducts()).toEqual([product]);
    fixture.componentInstance.selectCategoryFilter('Grains');
    expect(fixture.componentInstance.filteredProducts()).toEqual([]);
  });

  it('categoryCounts tallies products per category', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.categoryCounts()).toEqual({ Flour: 1 });
  });

  it('discountedPrice is derived from formData price and discount', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.set({ ...validFormData(), price: 100, discount: 20 });
    expect(fixture.componentInstance.discountedPrice()).toBe(80);
  });

  it('openAddForm resets the form and shows it in create mode', () => {
    const { fixture } = create();
    fixture.componentInstance.openAddForm();
    expect(fixture.componentInstance.showForm()).toBeTrue();
    expect(fixture.componentInstance.editingProduct()).toBeNull();
    expect(fixture.componentInstance.formData().name).toBe('');
  });

  it('editProduct populates the form with the given product', () => {
    const { fixture } = create();
    fixture.componentInstance.editProduct(product);
    expect(fixture.componentInstance.showForm()).toBeTrue();
    expect(fixture.componentInstance.editingProduct()).toEqual(product);
    expect(fixture.componentInstance.formData().name).toBe('Bajra Flour');
  });

  it('closeForm hides and resets the form', () => {
    const { fixture } = create();
    fixture.componentInstance.editProduct(product);
    fixture.componentInstance.closeForm();
    expect(fixture.componentInstance.showForm()).toBeFalse();
    expect(fixture.componentInstance.editingProduct()).toBeNull();
  });

  it('isValidImageSource accepts data URIs, local /images paths, and http(s) URLs', () => {
    const { fixture } = create();
    const c = fixture.componentInstance;
    expect(c.isValidImageSource('data:image/png;base64,abc')).toBeTrue();
    expect(c.isValidImageSource('/images/foo.jpg')).toBeTrue();
    expect(c.isValidImageSource('https://example.com/a.jpg')).toBeTrue();
    expect(c.isValidImageSource('not-a-url')).toBeFalse();
  });

  it('validateForm rejects an empty/invalid form and reports field errors', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.set({
      name: '',
      description: '',
      price: 0,
      discount: 200,
      category: '' as any,
      imageUrl: '',
      galleryImageUrls: [],
      weight: '',
      isAvailable: true,
      stockQuantity: null,
      lowStockThreshold: 5,
      ingredients: '',
      benefits: '',
      storageInfo: '',
    });

    const valid = fixture.componentInstance.validateForm();

    expect(valid).toBeFalse();
    expect(fixture.componentInstance.hasError('name')).toBeTrue();
    expect(fixture.componentInstance.hasError('description')).toBeTrue();
    expect(fixture.componentInstance.hasError('price')).toBeTrue();
    expect(fixture.componentInstance.hasError('discount')).toBeTrue();
    expect(fixture.componentInstance.hasError('category')).toBeTrue();
    expect(fixture.componentInstance.hasError('imageUrl')).toBeTrue();
    expect(fixture.componentInstance.hasError('weight')).toBeTrue();
    expect(fixture.componentInstance.hasError('ingredients')).toBeTrue();
    expect(fixture.componentInstance.hasError('benefits')).toBeTrue();
    expect(fixture.componentInstance.hasError('storageInfo')).toBeTrue();
  });

  it('validateForm passes for a fully valid form', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.set(validFormData());
    expect(fixture.componentInstance.validateForm()).toBeTrue();
    expect(Object.keys((fixture.componentInstance as any).formErrors())).toEqual([]);
  });

  it('submitForm shows an error and does not call the service when the form is invalid', () => {
    const { fixture, snackBar } = create();
    fixture.componentInstance.formData.set({ ...validFormData(), name: '' });

    fixture.componentInstance.submitForm();

    expect(snackBar.open).toHaveBeenCalledWith('Please fix the validation errors', 'Close', jasmine.any(Object));
    expect(productServiceSpy.createProduct).not.toHaveBeenCalled();
  });

  it('submitForm creates a new product, shows success, and closes the form', () => {
    productServiceSpy.createProduct.and.returnValue(of(product));
    const { fixture, snackBar } = create();
    fixture.componentInstance.formData.set(validFormData());

    fixture.componentInstance.submitForm();

    expect(productServiceSpy.createProduct).toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith(
      'Product created successfully',
      'Close',
      jasmine.any(Object),
    );
    expect(fixture.componentInstance.showForm()).toBeFalse();
    expect(fixture.componentInstance.submitting()).toBeFalse();
  });

  it('submitForm shows an error message when creation fails', () => {
    productServiceSpy.createProduct.and.returnValue(
      throwError(() => ({ error: { message: 'Server rejected it' } })),
    );
    const { fixture, snackBar } = create();
    fixture.componentInstance.formData.set(validFormData());

    fixture.componentInstance.submitForm();

    expect(snackBar.open).toHaveBeenCalledWith('Server rejected it', 'Close', jasmine.any(Object));
    expect(fixture.componentInstance.submitting()).toBeFalse();
  });

  it('submitForm updates the product being edited', () => {
    productServiceSpy.updateProduct.and.returnValue(of(product));
    const { fixture, snackBar } = create();
    fixture.componentInstance.editProduct(product);
    fixture.componentInstance.formData.set(validFormData());

    fixture.componentInstance.submitForm();

    expect(productServiceSpy.updateProduct).toHaveBeenCalledWith(
      jasmine.objectContaining({ id: 'p1' }),
    );
    expect(snackBar.open).toHaveBeenCalledWith(
      'Product updated successfully',
      'Close',
      jasmine.any(Object),
    );
  });

  // The PATCH/POST response is the saved product and the service has already applied it. Reading
  // the catalogue again straight afterwards is what let a cached, pre-save body overwrite it and
  // made the admin refresh two or three times before their edit appeared.
  it('does not re-read the catalogue after a save', () => {
    productServiceSpy.updateProduct.and.returnValue(of(product));
    const { fixture } = create();
    fixture.componentInstance.editProduct(product);
    fixture.componentInstance.formData.set(validFormData());
    productServiceSpy.loadProducts.calls.reset();

    fixture.componentInstance.submitForm();

    expect(productServiceSpy.loadProducts).not.toHaveBeenCalled();
  });

  it('does not re-read the catalogue after a create, a delete, or an availability toggle', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    productServiceSpy.createProduct.and.returnValue(of(product));
    productServiceSpy.deleteProduct.and.returnValue(of(undefined));
    productServiceSpy.updateProduct.and.returnValue(of({ ...product, isAvailable: false }));
    const { fixture } = create();
    fixture.componentInstance.formData.set(validFormData());
    productServiceSpy.loadProducts.calls.reset();

    fixture.componentInstance.submitForm();
    fixture.componentInstance.deleteProduct(product);
    fixture.componentInstance.toggleAvailability(product);

    expect(productServiceSpy.loadProducts).not.toHaveBeenCalled();
  });

  // Closing the tall form leaves the scroll offset past the end of the grid, at the footer. The
  // saved card is both the fix and the place the admin actually wants to be.
  it('marks the saved product so its card can be found after the form closes', () => {
    productServiceSpy.updateProduct.and.returnValue(of(product));
    const { fixture } = create();
    fixture.componentInstance.editProduct(product);
    fixture.componentInstance.formData.set(validFormData());

    fixture.componentInstance.submitForm();
    fixture.detectChanges();

    expect(fixture.componentInstance.justSavedId()).toBe('p1');
    const card = (fixture.nativeElement as HTMLElement).querySelector('#product-p1');
    expect(card).not.toBeNull();
    expect(card!.classList).toContain('just-saved');
  });

  it('widens the category filter when the saved product no longer matches it', () => {
    productServiceSpy.updateProduct.and.returnValue(of(product)); // product.category === 'Flour'
    const { fixture } = create();
    fixture.componentInstance.selectCategoryFilter('Grains');
    fixture.componentInstance.editProduct(product);
    fixture.componentInstance.formData.set(validFormData());

    fixture.componentInstance.submitForm();

    // Otherwise there would be no card to scroll to and the save would look like it vanished.
    expect(fixture.componentInstance.categoryFilter()).toBe('All');
  });

  it('deleteProduct does nothing if the confirmation dialog is declined', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    const { fixture } = create();

    fixture.componentInstance.deleteProduct(product);

    expect(productServiceSpy.deleteProduct).not.toHaveBeenCalled();
  });

  it('deleteProduct deletes the product and shows success when confirmed', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    productServiceSpy.deleteProduct.and.returnValue(of(undefined));
    const { fixture, snackBar } = create();

    fixture.componentInstance.deleteProduct(product);

    expect(productServiceSpy.deleteProduct).toHaveBeenCalledWith('p1');
    expect(snackBar.open).toHaveBeenCalledWith(
      'Product deleted successfully',
      'Close',
      jasmine.any(Object),
    );
  });

  it('deleteProduct shows an error message on failure', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    productServiceSpy.deleteProduct.and.returnValue(throwError(() => ({ error: {} })));
    const { fixture, snackBar } = create();

    fixture.componentInstance.deleteProduct(product);

    expect(snackBar.open).toHaveBeenCalledWith('Failed to delete product', 'Close', jasmine.any(Object));
  });

  it('toggleAvailability flips isAvailable via updateProduct', () => {
    productServiceSpy.updateProduct.and.returnValue(of({ ...product, isAvailable: false }));
    const { fixture } = create();

    fixture.componentInstance.toggleAvailability(product);

    expect(productServiceSpy.updateProduct).toHaveBeenCalledWith({ id: 'p1', isAvailable: false });
  });

  it('addGalleryImageSlot appends up to maxGalleryImages slots', () => {
    const { fixture } = create();
    for (let i = 0; i < 6; i++) fixture.componentInstance.addGalleryImageSlot();
    expect(fixture.componentInstance.formData().galleryImageUrls.length).toBe(5);
  });

  it('removeGalleryImage removes the slot at the given index', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.update((d) => ({ ...d, galleryImageUrls: ['a', 'b', 'c'] }));
    fixture.componentInstance.removeGalleryImage(1);
    expect(fixture.componentInstance.formData().galleryImageUrls).toEqual(['a', 'c']);
  });

  it('updateGalleryImageUrl updates the slot at the given index', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.update((d) => ({ ...d, galleryImageUrls: ['a', 'b'] }));
    fixture.componentInstance.updateGalleryImageUrl(1, 'new-url');
    expect(fixture.componentInstance.formData().galleryImageUrls).toEqual(['a', 'new-url']);
  });

  it('onImageUrlChange updates the preview only for a valid image source', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.update((d) => ({ ...d, imageUrl: '/images/ok.jpg' }));
    fixture.componentInstance.onImageUrlChange();
    expect(fixture.componentInstance.previewImage()).toBe('/images/ok.jpg');

    fixture.componentInstance.formData.update((d) => ({ ...d, imageUrl: 'not-valid' }));
    fixture.componentInstance.onImageUrlChange();
    expect(fixture.componentInstance.previewImage()).toBeNull();
  });

  it('onPreviewImageError swaps the broken preview image to the placeholder', () => {
    const { fixture } = create();
    const img = document.createElement('img');
    fixture.componentInstance.onPreviewImageError({ target: img } as unknown as Event);
    expect(img.src).toContain('/images/placeholder.svg');
  });

  it('onFileSelected surfaces whatever reason the upload service gives for refusing a file', () => {
    const { fixture, snackBar } = create();
    mediaUploadSpy.validate.and.returnValue('Image must be smaller than 12MB');
    const file = new File([new Uint8Array(8)], 'big.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    fixture.componentInstance.onFileSelected({ target: input } as unknown as Event);

    expect(snackBar.open).toHaveBeenCalledWith('Image must be smaller than 12MB', 'Close', jasmine.any(Object));
    expect(mediaUploadSpy.upload).not.toHaveBeenCalled();
  });

  // Images are no longer inlined as base64 on the product document - they are uploaded as their
  // own cacheable file and the product keeps only the URL. See MediaUploadService.
  it('onFileSelected uploads the file and stores the URL it comes back with', () => {
    const { fixture } = create();
    const file = new File(['tinydata'], 'small.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    fixture.componentInstance.onFileSelected({ target: input } as unknown as Event);

    expect(mediaUploadSpy.upload).toHaveBeenCalledWith(file, 'product');
    expect(fixture.componentInstance.formData().imageUrl).toBe('/api/media/abc.webp');
    expect(fixture.componentInstance.previewImage()).toBe('/api/media/abc.webp');
    expect(fixture.componentInstance.uploadingImage()).toBeFalse();
  });

  it('onGalleryFileSelected uploads into the slot it was given', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.update((d) => ({ ...d, galleryImageUrls: ['', ''] }));
    const file = new File(['tinydata'], 'small.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    fixture.componentInstance.onGalleryFileSelected({ target: input } as unknown as Event, 1);

    expect(fixture.componentInstance.formData().galleryImageUrls).toEqual(['', '/api/media/abc.webp']);
  });

  it('onFileSelected reports a failed upload and stops showing progress', () => {
    const { fixture, snackBar } = create();
    mediaUploadSpy.upload.and.returnValue(throwError(() => ({ error: { message: 'Storage is full' } })));
    const file = new File(['tinydata'], 'small.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    fixture.componentInstance.onFileSelected({ target: input } as unknown as Event);

    expect(snackBar.open).toHaveBeenCalledWith('Storage is full', 'Close', jasmine.any(Object));
    expect(fixture.componentInstance.uploadingImage()).toBeFalse();
    expect(fixture.componentInstance.formData().imageUrl).not.toBe('/api/media/abc.webp');
  });
});
