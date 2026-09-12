import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { HeroSlideService } from '../../services/hero-slide.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { HeroSlideConfig, UpdateHeroSlideRequest } from '../../models/interfaces';
import { SHIPPED_HERO_SLIDES } from '../../components/home-posters/home-posters';

function emptyFormData(): UpdateHeroSlideRequest {
  return {
    imageUrl: '',
    altText: '',
    linkUrl: '',
    isActive: true,
    sortOrder: 0,
  };
}

@Component({
  selector: 'app-hero-slide-management',
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatSnackBarModule,
  ],
  templateUrl: './hero-slide-management.html',
  styleUrl: './hero-slide-management.scss',
})
export class HeroSlideManagement implements OnInit {
  private readonly heroSlideService = inject(HeroSlideService);
  private readonly mediaUpload = inject(MediaUploadService);
  private readonly snackBar = inject(MatSnackBar);

  readonly slides = computed(() => this.heroSlideService.slides());
  readonly loading = computed(() => this.heroSlideService.loading());

  /**
   * How many of the owner's slides are actually on the rail. Zero is a meaningful state rather
   * than an error: the hero falls back to the artwork shipped with the site, and the admin needs
   * to be told that in so many words - otherwise "I turned them all off and the old picture is
   * still there" reads as a bug.
   */
  readonly liveCount = computed(() => this.slides().filter((s) => s.isActive && !!s.imageUrl).length);

  /** What the home page is showing while the owner has published nothing of their own. */
  readonly shippedSlides = SHIPPED_HERO_SLIDES;

  readonly submitting = signal(false);
  readonly uploadingImage = signal(false);

  // null = list view; 'new' = create form; an id = editing that slide.
  readonly editingId = signal<string | 'new' | null>(null);

  /** Briefly ringed on the card the admin just saved, so the change is visible on arrival. */
  readonly justSavedId = signal<string | null>(null);

  readonly formData = signal<UpdateHeroSlideRequest>(emptyFormData());
  readonly formErrors = signal<Partial<Record<keyof UpdateHeroSlideRequest, string>>>({});

  ngOnInit(): void {
    // bypassCache, always. An admin's read of this list must come from the origin - see the note
    // on loadSlides. Without it the pane can open showing a cached list that predates their own
    // last save, and there is nothing here to edit or delete that they did not just add.
    this.heroSlideService.loadSlides({ bypassCache: true });
  }

  startCreate(): void {
    this.formData.set({
      ...emptyFormData(),
      // Land it at the end of the rail rather than tied with an existing slide, so a new picture
      // never silently jumps in front of one the owner deliberately put first.
      sortOrder: this.slides().reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1,
    });
    this.formErrors.set({});
    this.editingId.set('new');
    this.scrollTo('hero-slide-form', 'start');
  }

  startEdit(slide: HeroSlideConfig): void {
    this.formData.set({
      imageUrl: slide.imageUrl,
      altText: slide.altText,
      linkUrl: slide.linkUrl,
      isActive: slide.isActive,
      sortOrder: slide.sortOrder,
    });
    this.formErrors.set({});
    this.editingId.set(slide.id);
    this.scrollTo('hero-slide-form', 'start');
  }

  cancelForm(): void {
    const wasEditing = this.editingId();
    this.editingId.set(null);

    // Back to the row they came from, rather than to wherever the form's height happened to
    // leave the page. Backing out of a new slide has no row to return to, so the list's top is
    // the honest destination.
    if (wasEditing && wasEditing !== 'new') this.scrollTo(`hero-slide-${wasEditing}`, 'center');
    else this.scrollTo('hero-slide-list-top', 'start');
  }

  deleteSlide(slide: HeroSlideConfig): void {
    if (!confirm('Remove this poster from the home page? This cannot be undone.')) return;

    this.heroSlideService.deleteSlide(slide.id).subscribe({
      next: () => {
        this.showSuccess('Slide removed');
        // The list just got shorter by one card. If the deleted row was near the end, the offset
        // that was fine a moment ago is now past the bottom of it.
        this.scrollTo('hero-slide-list-top', 'start');
      },
      error: (err) => this.showError(err?.error?.message ?? 'Failed to remove that slide'),
    });
  }

  /** Show or hide a slide straight from the list, without opening the form for a one-switch change. */
  toggleActive(slide: HeroSlideConfig): void {
    this.heroSlideService
      .updateSlide(slide.id, {
        imageUrl: slide.imageUrl,
        altText: slide.altText,
        linkUrl: slide.linkUrl,
        isActive: !slide.isActive,
        sortOrder: slide.sortOrder,
      })
      .subscribe({
        next: (updated) => this.showSuccess(updated.isActive ? 'Slide is now live' : 'Slide hidden'),
        error: (err) => this.showError(err?.error?.message ?? 'Failed to update that slide'),
      });
  }

  /**
   * Downscales, re-encodes and uploads the picture, then stores the URL it was given.
   *
   * The 'banner' preset, not 'product': this is the widest thing on the storefront and is shown
   * full-bleed, so it needs the extra width and the gentler compression.
   */
  onImageSelected(event: Event): void {
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
        this.formData.update((d) => ({ ...d, imageUrl: image.url }));
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

  clearImage(): void {
    this.formData.update((d) => ({ ...d, imageUrl: '' }));
  }

  private validateForm(): boolean {
    const errors: Partial<Record<keyof UpdateHeroSlideRequest, string>> = {};
    const data = this.formData();

    if (!data.imageUrl?.trim()) {
      errors.imageUrl = 'A slide needs a picture';
    }

    // Not a nicety. These posters carry the product names and the brand line as printed words,
    // so a slide with no description drops real content for anyone using a screen reader, and
    // for everybody when the picture fails to load.
    if (!data.altText?.trim()) {
      errors.altText = 'Describe the picture — this is what a screen reader announces';
    } else if (data.altText.trim().length > 300) {
      errors.altText = 'Keep the description under 300 characters';
    }

    this.formErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  save(): void {
    if (!this.validateForm()) {
      this.showError('Please fix the highlighted fields');
      return;
    }

    this.submitting.set(true);
    const data = this.formData();
    const request: UpdateHeroSlideRequest = {
      imageUrl: data.imageUrl?.trim() ?? '',
      altText: data.altText?.trim() ?? '',
      linkUrl: data.linkUrl?.trim() ?? '',
      isActive: data.isActive ?? false,
      sortOrder: Number(data.sortOrder) || 0,
    };

    const id = this.editingId();
    const request$ =
      id && id !== 'new'
        ? this.heroSlideService.updateSlide(id, request)
        : this.heroSlideService.createSlide(request);

    request$.subscribe({
      next: (saved) => {
        this.showSuccess(id && id !== 'new' ? 'Slide updated' : 'Slide added to the hero');
        this.submitting.set(false);
        this.editingId.set(null);
        this.revealSlide(saved);
      },
      error: (err) => {
        this.showError(err?.error?.message ?? 'Failed to save that slide');
        this.submitting.set(false);
      },
    });
  }

  getError(field: keyof UpdateHeroSlideRequest): string | undefined {
    return this.formErrors()[field];
  }

  hasError(field: keyof UpdateHeroSlideRequest): boolean {
    return !!this.formErrors()[field];
  }

  /**
   * Scrolls an element into view once it has actually been rendered.
   *
   * Retried across a few frames rather than scrolled on the next one, because the element is
   * usually created by the same signal write that requested the scroll - the card of a slide
   * that has just been added, or one revealed by the form above it collapsing. Whether Angular's
   * render lands before or after the first callback is not something to rely on, and giving up
   * on frame one silently does nothing. Smooth unless the reader has asked for less motion, in
   * which case it jumps: the point is arriving, not the travel.
   *
   * Same helper, same reasoning as the product admin - these panes must behave identically.
   */
  private scrollTo(elementId: string, block: ScrollLogicalPosition, attemptsLeft = 5): void {
    requestAnimationFrame(() => {
      const target = document.getElementById(elementId);
      if (!target) {
        if (attemptsLeft > 1) this.scrollTo(elementId, block, attemptsLeft - 1);
        return;
      }
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block });
    });
  }

  /**
   * Puts the admin back on the slide they just saved.
   *
   * Closing the form removes a tall element from the top of the pane and the browser keeps the
   * scroll offset it already had, which lands somewhere past the end of the list - at the footer,
   * with the thing they just did off-screen above them. Scrolling to the saved card is both the
   * fix for that and the more useful destination: it is the row whose change they want to see.
   */
  private revealSlide(slide: HeroSlideConfig): void {
    this.justSavedId.set(slide.id);
    this.scrollTo(`hero-slide-${slide.id}`, 'center');

    setTimeout(() => {
      if (this.justSavedId() === slide.id) this.justSavedId.set(null);
    }, 2500);
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 3000, panelClass: 'snack-success' });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 5000, panelClass: 'snack-error' });
  }
}
