import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DeliveryChargesService } from './delivery-charges.service';
import { environment } from '../../environments/environment';
import { DeliveryChargesConfig } from '../models/interfaces';

describe('DeliveryChargesService', () => {
  let service: DeliveryChargesService;
  let httpMock: HttpTestingController;

  const config: DeliveryChargesConfig = {
    id: 'c1',
    warehouseAddress: 'Sangvi, Pune',
    warehouseLatitude: 18.5672,
    warehouseLongitude: 73.7793,
    freeDeliveryUpToKm: 7,
    perKmChargeAfterFree: 10,
    isActive: true,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DeliveryChargesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushInitialLoad(cfg: DeliveryChargesConfig | null = config) {
    const req = httpMock.expectOne(environment.apiUrl + '/delivery-charges');
    if (cfg) req.flush(cfg);
    else req.flush('fail', { status: 500, statusText: 'err' });
  }

  it('loads config on construction', () => {
    flushInitialLoad();
    expect(service.config()).toEqual(config);
    expect(service.loading()).toBeFalse();
    expect(service.error()).toBeNull();
  });

  it('sets an error when the initial load fails', () => {
    flushInitialLoad(null);
    expect(service.error()).toBe('Failed to load delivery charges');
    expect(service.loading()).toBeFalse();
  });

  it('clearError resets the error', () => {
    flushInitialLoad(null);
    service.clearError();
    expect(service.error()).toBeNull();
  });

  it('updateConfig patches and syncs the config signal + clears error', () => {
    flushInitialLoad();
    const updated = { ...config, freeDeliveryUpToKm: 10 };
    service.updateConfig({ freeDeliveryUpToKm: 10 }).subscribe((res) => expect(res).toEqual(updated));
    const req = httpMock.expectOne(environment.apiUrl + '/delivery-charges');
    expect(req.request.method).toBe('PATCH');
    req.flush(updated);
    expect(service.config()).toEqual(updated);
    expect(service.error()).toBeNull();
  });

  it('previewCharge gets /delivery-charges/calculate with lat/lng params', () => {
    flushInitialLoad();
    let result: any;
    service.previewCharge(18.5, 73.8).subscribe((res) => (result = res));
    const req = httpMock.expectOne(
      (r) =>
        r.url === environment.apiUrl + '/delivery-charges/calculate' &&
        r.params.get('latitude') === '18.5' &&
        r.params.get('longitude') === '73.8',
    );
    req.flush({ distanceKm: 3, charge: 0, isFree: true });
    expect(result).toEqual({ distanceKm: 3, charge: 0, isFree: true });
  });

  describe('calculateDeliveryCharge (client-side estimate)', () => {
    it('returns free when config is not loaded', () => {
      flushInitialLoad(null);
      const result = service.calculateDeliveryCharge(20);
      expect(result).toEqual({ charge: 0, isFree: true, breakdown: 'Delivery charges not configured' });
    });

    it('returns free when config is inactive', () => {
      flushInitialLoad({ ...config, isActive: false });
      const result = service.calculateDeliveryCharge(20);
      expect(result.isFree).toBeTrue();
      expect(result.charge).toBe(0);
    });

    it('returns free within the free-delivery radius', () => {
      flushInitialLoad();
      const result = service.calculateDeliveryCharge(5);
      expect(result.isFree).toBeTrue();
      expect(result.charge).toBe(0);
      expect(result.breakdown).toContain('Free delivery');
    });

    it('charges for the distance beyond the free radius', () => {
      flushInitialLoad(); // freeUpTo 7km, 10/km after
      const result = service.calculateDeliveryCharge(10); // 3km chargeable * 10 = 30
      expect(result.isFree).toBeFalse();
      expect(result.charge).toBe(30);
      expect(result.breakdown).toContain('7 km free');
    });
  });
});
