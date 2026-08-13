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
    backgroundImageUrl: '',
    isActive: true,
    featuredSectionTitle: 'This Campaign',
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

  it('loads campaigns on construction', () => {
    const req = httpMock.expectOne(environment.apiUrl + '/campaign-banner');
    req.flush([config]);
    expect(service.campaigns()).toEqual([config]);
    expect(service.loading()).toBeFalse();
  });

  it('sets campaigns to an empty list (not an error signal) when the initial load fails, since errors are caught', () => {
    const req = httpMock.expectOne(environment.apiUrl + '/campaign-banner');
    req.flush('fail', { status: 500, statusText: 'err' });
    expect(service.campaigns()).toEqual([]);
    expect(service.loading()).toBeFalse();
  });

  it('createCampaign posts and appends the new campaign to the signal', () => {
    httpMock.expectOne(environment.apiUrl + '/campaign-banner').flush([]);
    const created = { ...config, id: 'b2' };
    service.createCampaign({ title: 'Festive Sale' }).subscribe((res) => expect(res).toEqual(created));
    const req = httpMock.expectOne(environment.apiUrl + '/campaign-banner');
    expect(req.request.method).toBe('POST');
    req.flush(created);
    expect(service.campaigns()).toEqual([created]);
    expect(service.error()).toBeNull();
  });

  it('updateCampaign patches the given id and syncs that campaign in the signal', () => {
    httpMock.expectOne(environment.apiUrl + '/campaign-banner').flush([config]);
    const updated = { ...config, title: 'New Title' };
    service.updateCampaign('b1', { title: 'New Title' }).subscribe((res) => expect(res).toEqual(updated));
    const req = httpMock.expectOne(environment.apiUrl + '/campaign-banner/b1');
    expect(req.request.method).toBe('PATCH');
    req.flush(updated);
    expect(service.campaigns()).toEqual([updated]);
    expect(service.error()).toBeNull();
  });

  it('deleteCampaign removes the campaign from the signal', () => {
    httpMock.expectOne(environment.apiUrl + '/campaign-banner').flush([config]);
    service.deleteCampaign('b1').subscribe();
    const req = httpMock.expectOne(environment.apiUrl + '/campaign-banner/b1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(service.campaigns()).toEqual([]);
  });

  it('clearError resets error to null', () => {
    httpMock.expectOne(environment.apiUrl + '/campaign-banner').flush([config]);
    service.clearError();
    expect(service.error()).toBeNull();
  });

  it('loadCampaigns can be called again to refresh', () => {
    httpMock.expectOne(environment.apiUrl + '/campaign-banner').flush([config]);
    service.loadCampaigns();
    expect(service.loading()).toBeTrue();
    const req = httpMock.expectOne(environment.apiUrl + '/campaign-banner');
    const refreshed = [{ ...config, title: 'Refreshed' }];
    req.flush(refreshed);
    expect(service.campaigns()).toEqual(refreshed);
  });
});
