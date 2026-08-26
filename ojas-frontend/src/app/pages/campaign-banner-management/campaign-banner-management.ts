import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { CampaignBannerService } from '../../services/campaign-banner.service';
import { ProductService } from '../../services/product.service';
import { CampaignBannerConfig, UpdateCampaignBannerRequest } from '../../models/interfaces';
import { CampaignBanner } from '../../components/campaign-banner/campaign-banner';
import { MediaUploadService } from '../../services/media-upload.service';

function emptyFormData(): UpdateCampaignBannerRequest {
  return {
    title: '',
    subtitle: '',
    ctaText: 'Shop Now',
    ctaLink: '/products',
    backgroundImageUrl: '',
    isActive: false,
    featuredSectionTitle: 'This Campaign',
    featuredProductIds: [],
    fallbackBestsellerProductIds: [],
  };
}

@Component({
  selector: 'app-campaign-banner-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatSlideToggleModule,
    MatChipsModule,
    CampaignBanner,
  ],
  templateUrl: './campaign-banner-management.html',
  styleUrl: './campaign-banner-management.scss',
})
export class CampaignBannerManagement implements OnInit {
  private campaignBannerService = inject(CampaignBannerService);
  private productService = inject(ProductService);
  private snackBar = inject(MatSnackBar);
  private mediaUpload = inject(MediaUploadService);

  readonly campaigns = computed(() => this.campaignBannerService.campaigns());
  readonly loading = computed(() => this.campaignBannerService.loading());
  readonly products = computed(() => this.productService.products());

  readonly submitting = signal(false);
  readonly uploadingImage = signal(false);
  readonly productSearch = signal('');

  // null = list view; 'new' = create form; an id = editing that campaign.
  readonly editingId = signal<string | 'new' | null>(null);

  readonly filteredProducts = computed(() => {
    const term = this.productSearch().trim().toLowerCase();
    const all = this.products();
    return term ? all.filter((p) => p.name.toLowerCase().includes(term)) : all;
  });

  readonly formData = signal<UpdateCampaignBannerRequest>(emptyFormData());
  readonly formErrors = signal<Partial<Record<keyof UpdateCampaignBannerRequest, string>>>({});

  ngOnInit(): void {
    this.campaignBannerService.loadCampaigns();
  }

  private toFormData(cfg: CampaignBannerConfig): UpdateCampaignBannerRequest {
    return {
      title: cfg.title,
      subtitle: cfg.subtitle,
      ctaText: cfg.ctaText,
      ctaLink: cfg.ctaLink,
      backgroundImageUrl: cfg.backgroundImageUrl,
      isActive: cfg.isActive,
      featuredSectionTitle: cfg.featuredSectionTitle || 'This Campaign',
      featuredProductIds: [...(cfg.featuredProductIds ?? [])],
      fallbackBestsellerProductIds: [...(cfg.fallbackBestsellerProductIds ?? [])],
    };
  }

  startCreate(): void {
    this.formData.set(emptyFormData());
    this.formErrors.set({});
    this.productSearch.set('');
    this.editingId.set('new');
  }

  startEdit(campaign: CampaignBannerConfig): void {
    this.formData.set(this.toFormData(campaign));
    this.formErrors.set({});
    this.productSearch.set('');
    this.editingId.set(campaign.id);
  }

  cancelForm(): void {
    this.editingId.set(null);
  }

  deleteCampaign(campaign: CampaignBannerConfig): void {
    if (!confirm(`Delete "${campaign.title || 'this untitled campaign'}"? This can't be undone.`)) {
      return;
    }
    this.campaignBannerService.deleteCampaign(campaign.id).subscribe({
      next: () => this.showSuccess('Campaign deleted'),
      error: (err) => this.showError(err?.error?.message ?? 'Failed to delete campaign'),
    });
  }

  /**
   * Downscales, re-encodes and uploads the picture, then stores the URL it was given.
   *
   * The banner used to be kept as a base64 string on the campaign document itself, which meant
   * every visitor downloaded the full image inside the campaign JSON on every page load, with
   * no way for any cache to help. It is now a file of its own behind an immutable URL - see
   * MediaUploadService and the API's MediaController.
   */
  onBackgroundImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    const problem = this.mediaUpload.validate(file);
    if (problem) {
      this.showError(problem);
      // Let the same file be picked again once the admin has fixed it.
      input.value = '';
      return;
    }

    this.uploadingImage.set(true);
    this.mediaUpload.upload(file, 'banner').subscribe({
      next: (image) => {
        this.formData.update((d) => ({ ...d, backgroundImageUrl: image.url }));
        this.uploadingImage.set(false);
        input.value = '';
      },
      error: (err) => {
        this.showError(err?.error?.message ?? 'Could not upload that image. Please try again.');
        this.uploadingImage.set(false);
        input.value = '';
      },
    });
  }

  clearBackgroundImage(): void {
    this.formData.update((d) => ({ ...d, backgroundImageUrl: '' }));
  }

  isFeatured(productId: string): boolean {
    return this.formData().featuredProductIds?.includes(productId) ?? false;
  }

  toggleFeatured(productId: string): void {
    this.formData.update((d) => {
      const current = d.featuredProductIds ?? [];
      const featuredProductIds = current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId];
      return { ...d, featuredProductIds };
    });
  }

  isFallbackBestseller(productId: string): boolean {
    return this.formData().fallbackBestsellerProductIds?.includes(productId) ?? false;
  }

  toggleFallbackBestseller(productId: string): void {
    this.formData.update((d) => {
      const current = d.fallbackBestsellerProductIds ?? [];
      const fallbackBestsellerProductIds = current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId];
      return { ...d, fallbackBestsellerProductIds };
    });
  }

  validateForm(): boolean {
    const errors: Partial<Record<keyof UpdateCampaignBannerRequest, string>> = {};
    const data = this.formData();

    // Title is optional on purpose: festival artwork usually carries its own headline,
    // and a second one laid over the picture looked like a mistake. A campaign with no
    // title is just the picture and its button.
    if ((data.title?.trim().length ?? 0) > 100) {
      errors.title = 'Title must not exceed 100 characters';
    }

    if ((data.subtitle?.length ?? 0) > 200) {
      errors.subtitle = 'Subtitle must not exceed 200 characters';
    }

    if ((data.featuredSectionTitle?.length ?? 0) > 60) {
      errors.featuredSectionTitle = 'Keep this under 60 characters';
    }

    this.formErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  saveConfig(): void {
    if (!this.validateForm()) {
      this.showError('Please fix the validation errors');
      return;
    }

    this.submitting.set(true);
    const data = this.formData();
    const request: UpdateCampaignBannerRequest = {
      title: data.title?.trim() ?? '',
      subtitle: data.subtitle?.trim() ?? '',
      ctaText: data.ctaText?.trim() ?? '',
      ctaLink: data.ctaLink?.trim() ?? '',
      backgroundImageUrl: data.backgroundImageUrl?.trim() ?? '',
      isActive: data.isActive ?? false,
      featuredSectionTitle: data.featuredSectionTitle?.trim() || 'This Campaign',
      featuredProductIds: data.featuredProductIds ?? [],
      fallbackBestsellerProductIds: data.fallbackBestsellerProductIds ?? [],
    };

    const id = this.editingId();
    const request$ =
      id && id !== 'new'
        ? this.campaignBannerService.updateCampaign(id, request)
        : this.campaignBannerService.createCampaign(request);

    request$.subscribe({
      next: () => {
        this.showSuccess(id && id !== 'new' ? 'Campaign updated successfully' : 'Campaign created successfully');
        this.submitting.set(false);
        this.editingId.set(null);
      },
      error: (err) => {
        this.showError(err?.error?.message ?? 'Failed to save campaign');
        this.submitting.set(false);
      },
    });
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3000, panelClass: 'snack-success' });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 5000, panelClass: 'snack-error' });
  }

  getError(field: keyof UpdateCampaignBannerRequest): string | undefined {
    return this.formErrors()[field];
  }

  hasError(field: keyof UpdateCampaignBannerRequest): boolean {
    return !!this.formErrors()[field];
  }
}
