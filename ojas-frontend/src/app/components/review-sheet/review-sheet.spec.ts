import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReviewSheet } from './review-sheet';
import { ReviewService } from '../../services/review.service';
import { ProductReview } from '../../models/interfaces';

describe('ReviewSheet', () => {
  let fixture: ComponentFixture<ReviewSheet>;
  let reviews: jasmine.SpyObj<ReviewService>;

  const saved: ProductReview = {
    id: 'r1',
    productId: 'p1',
    productName: 'Modak Pith',
    authorName: 'Priya S.',
    rating: 4,
    comment: 'Soft modaks.',
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: null,
  };

  function create(initialRating = 0, existing: ProductReview | null = null) {
    reviews = jasmine.createSpyObj('ReviewService', ['create', 'update', 'remove']);
    TestBed.configureTestingModule({
      imports: [ReviewSheet],
      providers: [{ provide: ReviewService, useValue: reviews }],
    });
    fixture = TestBed.createComponent(ReviewSheet);
    fixture.componentRef.setInput('productId', 'p1');
    fixture.componentRef.setInput('productName', 'Modak Pith');
    fixture.componentRef.setInput('initialRating', initialRating);
    fixture.componentRef.setInput('existing', existing);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function submit(el: HTMLElement) {
    (el.querySelector('.rs-submit') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  it('asks for a star before posting, and sends nothing without one', () => {
    const el = create();
    submit(el);
    expect(reviews.create).not.toHaveBeenCalled();
    expect(el.querySelector('.rs-error')?.textContent).toContain('Tap a star');
  });

  it('starts on the star tapped on the page that opened it, and posts it with the words', () => {
    const el = create(4);
    reviews.create.and.returnValue(of(saved));
    const emitted = jasmine.createSpy('saved');
    fixture.componentInstance.saved.subscribe(emitted);

    expect(el.querySelectorAll('.rs-star.on').length).toBe(4);
    const box = el.querySelector('textarea') as HTMLTextAreaElement;
    box.value = '  Soft modaks.  ';
    box.dispatchEvent(new Event('input'));
    submit(el);

    expect(reviews.create).toHaveBeenCalledWith('p1', { rating: 4, comment: 'Soft modaks.' }, null);
    expect(emitted).toHaveBeenCalledWith(saved);
  });

  it("shows the API's reason when a save is refused", () => {
    const el = create(5);
    reviews.create.and.returnValue(
      throwError(() => ({ error: { message: 'You can review a product once an order with it has been delivered to you.' } })),
    );
    submit(el);
    expect(el.querySelector('.rs-error')?.textContent).toContain('delivered to you');
  });

  it('edits an existing review by its id rather than posting a new one', () => {
    const el = create(0, saved);
    reviews.update.and.returnValue(of({ ...saved, rating: 2 }));
    (el.querySelectorAll('.rs-star')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    submit(el);
    expect(reviews.update).toHaveBeenCalledWith('r1', { rating: 2, comment: 'Soft modaks.' });
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('asks twice before deleting an existing review', () => {
    const el = create(0, saved);
    reviews.remove.and.returnValue(of(void 0));
    const remove = el.querySelector('.rs-remove') as HTMLButtonElement;
    remove.click();
    fixture.detectChanges();
    expect(reviews.remove).not.toHaveBeenCalled();
    remove.click();
    expect(reviews.remove).toHaveBeenCalledWith('r1');
  });
});
