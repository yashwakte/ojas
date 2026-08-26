import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProductService } from '../../services/product.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { Product, CreateProductRequest, UpdateProductRequest } from '../../models/interfaces';
import { PRODUCT_CATEGORIES } from '../../constants/product-categories';

@Component({
  selector: 'app-product-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  templateUrl: './product-management.html',
  styleUrl: './product-management.scss',
})
export class ProductManagement implements OnInit {
  private productService = inject(ProductService);
  private snackBar = inject(MatSnackBar);
  private mediaUpload = inject(MediaUploadService);

  readonly categories = PRODUCT_CATEGORIES;

  readonly products = computed(() => this.productService.products());
  readonly loading = computed(() => this.productService.loading());
  readonly error = computed(() => this.productService.error());

  readonly categoryFilter = signal<'All' | (typeof PRODUCT_CATEGORIES)[number]>('All');

  readonly filteredProducts = computed(() => {
    const filter = this.categoryFilter();
    const all = this.products();
    return filter === 'All' ? all : all.filter((p) => p.category === filter);
  });

  readonly categoryCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const p of this.products()) {
      counts[p.category] = (counts[p.category] ?? 0) + 1;
    }
    return counts;
  });

  selectCategoryFilter(cat: 'All' | (typeof PRODUCT_CATEGORIES)[number]): void {
    this.categoryFilter.set(cat);
  }

  readonly showForm = signal(false);
  readonly editingProduct = signal<Product | null>(null);
  readonly submitting = signal(false);
  readonly previewImage = signal<string | null>(null);
  readonly uploadingImage = signal(false);

  readonly formData = signal<CreateProductRequest>({
    name: '',
    description: '',
    price: 0,
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
  });

  readonly maxGalleryImages = 5;

  readonly formErrors = signal<Partial<Record<keyof CreateProductRequest, string>>>({});

  readonly discountedPrice = computed(() => {
    const price = this.formData().price;
    const discount = this.formData().discount;
    return price - (price * discount) / 100;
  });

  ngOnInit(): void {
    this.productService.loadProducts();
  }

  private populateForm(product: Product): void {
    this.formData.set({
      name: product.name,
      description: product.description,
      price: product.price,
      discount: product.discount,
      category: product.category,
      imageUrl: product.imageUrl,
      galleryImageUrls: [...(product.galleryImageUrls ?? [])],
      weight: product.weight,
      isAvailable: product.isAvailable,
      stockQuantity: product.stockQuantity,
      lowStockThreshold: product.lowStockThreshold,
      ingredients: product.ingredients,
      benefits: product.benefits,
      storageInfo: product.storageInfo,
    });
    this.previewImage.set(product.imageUrl || null);
    this.formErrors.set({});
  }

  openAddForm(): void {
    this.editingProduct.set(null);
    this.resetForm();
    this.showForm.set(true);
  }

  editProduct(product: Product): void {
    // Populate before revealing the form so every field renders with the selected
    // product's values. Keeping this out of an effect also prevents repeated form
    // resets while the user is editing.
    this.populateForm(product);
    this.editingProduct.set(product);
    this.showForm.set(true);
  }

  closeForm(): void {
    this.showForm.set(false);
    this.editingProduct.set(null);
    this.resetForm();
  }

  private resetForm(): void {
    this.formData.set({
      name: '',
      description: '',
      price: 0,
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
    });
    this.previewImage.set(null);
    this.formErrors.set({});
  }

  onImageUrlChange(): void {
    const url = this.formData().imageUrl;
    if (url && this.isValidImageSource(url)) {
      this.previewImage.set(url);
    } else {
      this.previewImage.set(null);
    }
  }

  onPreviewImageError(event: Event): void {
    const image = event.target as HTMLImageElement;
    image.src = '/images/placeholder.svg';
  }

  addGalleryImageSlot(): void {
    this.formData.update((data) =>
      data.galleryImageUrls.length >= this.maxGalleryImages
        ? data
        : { ...data, galleryImageUrls: [...data.galleryImageUrls, ''] },
    );
  }

  removeGalleryImage(index: number): void {
    this.formData.update((data) => ({
      ...data,
      galleryImageUrls: data.galleryImageUrls.filter((_, i) => i !== index),
    }));
  }

  updateGalleryImageUrl(index: number, url: string): void {
    this.formData.update((data) => ({
      ...data,
      galleryImageUrls: data.galleryImageUrls.map((existing, i) => (i === index ? url : existing)),
    }));
  }

  onGalleryFileSelected(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    this.uploadImage(input, (url) => this.updateGalleryImageUrl(index, url));
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    this.uploadImage(input, (url) => {
      this.formData.update((data) => ({ ...data, imageUrl: url }));
      this.previewImage.set(url);
    });
  }

  /**
   * Shared by the main photo and every gallery slot: downscale and re-encode the file in the
   * browser, upload it, and hand back the URL it now lives at.
   *
   * Product images used to be stored as base64 strings on the product document, which put a
   * multi-megabyte blob inside every catalog response and pushed each document towards Mongo's
   * 16 MB per-document ceiling. They are now separate, immutably cached files - see
   * MediaUploadService.
   */
  private uploadImage(input: HTMLInputElement, apply: (url: string) => void): void {
    const file = input.files![0];
    const problem = this.mediaUpload.validate(file);
    if (problem) {
      this.showError(problem);
      input.value = '';
      return;
    }

    this.uploadingImage.set(true);
    this.mediaUpload.upload(file, 'product').subscribe({
      next: (image) => {
        apply(image.url);
        this.uploadingImage.set(false);
        // Clearing it lets the admin re-pick the same file, e.g. after re-exporting it.
        input.value = '';
      },
      error: (err) => {
        this.showError(err?.error?.message ?? 'Could not upload that image. Please try again.');
        this.uploadingImage.set(false);
        input.value = '';
      },
    });
  }

  validateForm(): boolean {
    const errors: Partial<Record<keyof CreateProductRequest, string>> = {};
    const data = this.formData();

    if (!data.name.trim()) errors.name = 'Product name is required';
    else if (data.name.trim().length < 2) errors.name = 'Name must be at least 2 characters';
    else if (data.name.trim().length > 100) errors.name = 'Name must not exceed 100 characters';

    if (!data.description.trim()) errors.description = 'Description is required';
    else if (data.description.trim().length < 10) errors.description = 'Description must be at least 10 characters';
    else if (data.description.trim().length > 2000) errors.description = 'Description must not exceed 2000 characters';

    if (!data.price || data.price <= 0) errors.price = 'Price must be greater than 0';
    else if (data.price > 100000) errors.price = 'Price seems too high';

    if (data.discount < 0 || data.discount > 100) errors.discount = 'Discount must be between 0 and 100';

    if (!data.category) errors.category = 'Category is required';

    if (!data.imageUrl.trim()) errors.imageUrl = 'Image URL is required';
    else if (!this.isValidImageSource(data.imageUrl)) {
      errors.imageUrl = 'Please enter a valid image URL, a local /images path, or upload an image';
    }

    if (data.galleryImageUrls.some((url) => url.trim() && !this.isValidImageSource(url))) {
      errors.galleryImageUrls = 'Each additional image must be a valid image URL, a local /images path, or an upload';
    }

    if (!data.weight.trim()) errors.weight = 'Weight is required';

    if (!data.ingredients.trim()) errors.ingredients = 'Ingredients are required';
    else if (data.ingredients.trim().length < 5) errors.ingredients = 'Please provide ingredients (min 5 characters)';
    else if (data.ingredients.trim().length > 3000) errors.ingredients = 'Ingredients must not exceed 3000 characters';

    if (!data.benefits.trim()) errors.benefits = 'Benefits are required';
    else if (data.benefits.trim().length < 10) errors.benefits = 'Please describe benefits (min 10 characters)';
    else if (data.benefits.trim().length > 3000) errors.benefits = 'Benefits must not exceed 3000 characters';

    if (!data.storageInfo.trim()) errors.storageInfo = 'Storage info is required';
    else if (data.storageInfo.trim().length < 10) errors.storageInfo = 'Please provide storage info (min 10 characters)';
    else if (data.storageInfo.trim().length > 2000) errors.storageInfo = 'Storage info must not exceed 2000 characters';

    this.formErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  private isValidUrl(string: string): boolean {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  isValidImageSource(value: string): boolean {
    const imageSource = value.trim();
    return (
      imageSource.startsWith('data:image/') ||
      imageSource.startsWith('/images/') ||
      this.isValidUrl(imageSource)
    );
  }

  submitForm(): void {
    if (!this.validateForm()) {
      this.showError('Please fix the validation errors');
      return;
    }

    this.submitting.set(true);
    const data = this.formData();
    const sanitizedData = this.sanitizeFormData(data);

    if (this.editingProduct()) {
      const request: UpdateProductRequest = { id: this.editingProduct()!.id, ...sanitizedData };
      this.productService.updateProduct(request).subscribe({
        next: () => {
          this.showSuccess('Product updated successfully');
          this.closeForm();
          this.productService.loadProducts();
          this.submitting.set(false);
        },
        error: (err) => {
          this.showError(err?.error?.message ?? 'Failed to update product');
          this.submitting.set(false);
        },
      });
    } else {
      this.productService.createProduct(sanitizedData).subscribe({
        next: () => {
          this.showSuccess('Product created successfully');
          this.closeForm();
          this.productService.loadProducts();
          this.submitting.set(false);
        },
        error: (err) => {
          this.showError(err?.error?.message ?? 'Failed to create product');
          this.submitting.set(false);
        },
      });
    }
  }

  deleteProduct(product: Product): void {
    if (!confirm(`Are you sure you want to delete "${product.name}"? This action cannot be undone.`)) {
      return;
    }

    this.productService.deleteProduct(product.id).subscribe({
      next: () => {
        this.showSuccess('Product deleted successfully');
        this.productService.loadProducts();
      },
      error: (err) => {
        this.showError(err?.error?.message ?? 'Failed to delete product');
      },
    });
  }

  toggleAvailability(product: Product): void {
    const request: UpdateProductRequest = { id: product.id, isAvailable: !product.isAvailable };
    this.productService.updateProduct(request).subscribe({
      next: () => {
        this.productService.loadProducts();
      },
      error: (err) => {
        this.showError(err?.error?.message ?? 'Failed to update availability');
      },
    });
  }

  private sanitizeFormData(data: CreateProductRequest): CreateProductRequest {
    return {
      name: this.sanitizeString(data.name),
      description: this.sanitizeString(data.description),
      price: Number(data.price.toFixed(2)),
      discount: Math.round(data.discount),
      category: this.sanitizeString(data.category),
      imageUrl: data.imageUrl.trim(),
      galleryImageUrls: data.galleryImageUrls.map((url) => url.trim()).filter(Boolean),
      weight: this.sanitizeString(data.weight),
      isAvailable: data.isAvailable,
      stockQuantity: data.stockQuantity ?? null,
      lowStockThreshold: data.lowStockThreshold ?? 5,
      ingredients: this.sanitizeString(data.ingredients),
      benefits: this.sanitizeString(data.benefits),
      storageInfo: this.sanitizeString(data.storageInfo),
    };
  }

  private sanitizeString(str: string): string {
    return str.trim().replace(/[<>]/g, '');
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3000, panelClass: 'snack-success' });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 5000, panelClass: 'snack-error' });
  }

  getError(field: keyof CreateProductRequest): string | undefined {
    return this.formErrors()[field];
  }

  hasError(field: keyof CreateProductRequest): boolean {
    return !!this.formErrors()[field];
  }
}
