import { TestBed } from '@angular/core/testing';
import { ScrollLockService } from './scroll-lock.service';

describe('ScrollLockService', () => {
  afterEach(() => {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  });

  it('holds the page until the last hold is released', () => {
    const locks = TestBed.inject(ScrollLockService);

    const drawer = locks.lock();
    const search = locks.lock();
    expect(document.body.style.overflow).toBe('hidden');

    // The drawer closing as the search it opened comes up must not unlock the page under it.
    drawer();
    expect(document.body.style.overflow).toBe('hidden');

    search();
    expect(document.body.style.overflow).toBe('');
  });

  it('treats a second release of the same hold as a no-op', () => {
    const locks = TestBed.inject(ScrollLockService);

    const first = locks.lock();
    const second = locks.lock();
    first();
    first();

    expect(document.body.style.overflow).toBe('hidden');
    second();
    expect(document.body.style.overflow).toBe('');
  });
});
