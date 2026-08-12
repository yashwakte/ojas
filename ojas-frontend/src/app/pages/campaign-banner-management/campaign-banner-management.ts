import { Component, OnInit, signal, computed, effect, inject } from '@angular/core';
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
  ],
  templateUrl: './campaign-banner-management.html',
  styleUrl: './campaign-banner-management.scss',
})
export class CampaignBannerManagement implements OnInit {
  private campaignBannerService = inject(CampaignBannerService);
  private productService = inject(ProductService);
  private snackBar = inject(MatSnackBar);

  readonly config = computed(() => this.campaignBannerService.config());
  readonly loading = computed(() => this.campaignBannerService.loading());
  readonly products = computed(() => this.productService.products());

  readonly submitting = signal(false);
  readonly productSearch = signal('');

  readonly filteredProducts = computed(() => {
    const term = this.productSearch().trim().toLowerCase();
    const all = this.products();
    return term ? all.filter((p) => p.name.toLowerCase().includes(term)) : all;
  });

  readonly formData = signal<UpdateCampaignBannerRequest>({
    title: '',
    subtitle: '',
    ctaText: 'Shop Now',
    ctaLink: '/products',
    isActive: false,
    featuredProductIds: [],
    fallbackBestsellerProductIds: [],
  });

  readonly formErrors = signal<Partial<Record<keyof UpdateCampaignBannerRequest, string>>>({});

  constructor() {
    effect(() => {
      const cfg = this.config();
      if (cfg) {
        this.formData.set(this.toFormData(cfg));
      }
    });
  }

  ngOnInit(): void {
    this.campaignBannerService.loadConfig();
  }

  private toFormData(cfg: CampaignBannerConfig): UpdateCampaignBannerRequest {
    return {
      title: cfg.title,
      subtitle: cfg.subtitle,
      ctaText: cfg.ctaText,
      ctaLink: cfg.ctaLink,
      isActive: cfg.isActive,
      featuredProductIds: [...(cfg.featuredProductIds ?? [])],
      fallbackBestsellerProductIds: [...(cfg.fallbackBestsellerProductIds ?? [])],
    };
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

    if (!data.title?.trim()) {
      errors.title = 'Title is required';
    } else if (data.title.trim().length > 100) {
      errors.title = 'Title must not exceed 100 characters';
    }

    if ((data.subtitle?.length ?? 0) > 200) {
      errors.subtitle = 'Subtitle must not exceed 200 characters';
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
      isActive: data.isActive ?? false,
      featuredProductIds: data.featuredProductIds ?? [],
      fallbackBestsellerProductIds: data.fallbackBestsellerProductIds ?? [],
    };

    this.campaignBannerService.updateConfig(request).subscribe({
      next: () => {
        this.showSuccess('Campaign banner updated successfully');
        this.submitting.set(false);
      },
      error: (err) => {
        this.showError(err?.error?.message ?? 'Failed to update campaign banner');
        this.submitting.set(false);
      },
    });
  }

  toggleActive(event: { checked: boolean }): void {
    this.formData.update((d) => ({ ...d, isActive: event.checked }));
    this.saveConfig();
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3000, panelClass: 'success-snackbar' });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 5000, panelClass: 'error-snackbar' });
  }

  getError(field: keyof UpdateCampaignBannerRequest): string | undefined {
    return this.formErrors()[field];
  }

  hasError(field: keyof UpdateCampaignBannerRequest): boolean {
    return !!this.formErrors()[field];
  }
}
