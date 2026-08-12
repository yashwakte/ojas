import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CampaignBannerService } from './campaign-banner.service';
import { environment } from '../../environments/environment';
import { CampaignBannerConfig } from '../models/interfaces';

describe('CampaignBannerService', () => {
  let service: CampaignBannerService;
  let httpMock: HttpTestingController;

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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CampaignBannerService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads config on construction', () => {
    const req = httpMock.expectOne(environment.apiUrl + '/campaign-banner');
    req.flush(config);
    expect(service.config()).toEqual(config);
    expect(service.loading()).toBeFalse();
  });

  it('sets config to null (not an error signal) when the initial load fails, since errors are caught', () => {
    const req = httpMock.expectOne(environment.apiUrl + '/campaign-banner');
    req.flush('fail', { status: 500, statusText: 'err' });
    expect(service.config()).toBeNull();
    expect(service.loading()).toBeFalse();
  });

  it('updateConfig patches and syncs the config signal + clears error', () => {
    httpMock.expectOne(environment.apiUrl + '/campaign-banner').flush(config);
    const updated = { ...config, title: 'New Title' };
    service.updateConfig({ title: 'New Title' }).subscribe((res) => expect(res).toEqual(updated));
    const req = httpMock.expectOne(environment.apiUrl + '/campaign-banner');
    expect(req.request.method).toBe('PATCH');
    req.flush(updated);
    expect(service.config()).toEqual(updated);
    expect(service.error()).toBeNull();
  });

  it('clearError resets error to null', () => {
    httpMock.expectOne(environment.apiUrl + '/campaign-banner').flush(config);
    service.clearError();
    expect(service.error()).toBeNull();
  });

  it('loadConfig can be called again to refresh', () => {
    httpMock.expectOne(environment.apiUrl + '/campaign-banner').flush(config);
    service.loadConfig();
    expect(service.loading()).toBeTrue();
    const req = httpMock.expectOne(environment.apiUrl + '/campaign-banner');
    const updated = { ...config, title: 'Refreshed' };
    req.flush(updated);
    expect(service.config()).toEqual(updated);
  });
});
