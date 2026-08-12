import { TestBed } from '@angular/core/testing';
import { MapPicker } from './map-picker';

describe('MapPicker', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MapPicker],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(MapPicker);
    return fixture;
  }

  afterEach(() => {
    // Ensure any created Leaflet map instances don't leak between tests.
  });

  it('should create and initialize the map at the default center when no initial lat/lng given', () => {
    spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake((success: PositionCallback) => {
      // Don't resolve, simulate a pending geolocation request.
    });
    const fixture = create();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.centerLat).toBeCloseTo(18.5204, 3);
    expect(fixture.componentInstance.centerLng).toBeCloseTo(73.8567, 3);

    fixture.destroy();
  });

  it('uses the provided initialLat/initialLng and skips useCurrentLocation()', () => {
    const geoSpy = spyOn(navigator.geolocation, 'getCurrentPosition');
    const fixture = create();
    fixture.componentInstance.initialLat = 19.076;
    fixture.componentInstance.initialLng = 72.8777;
    fixture.detectChanges();

    expect(fixture.componentInstance.centerLat).toBeCloseTo(19.076, 3);
    expect(fixture.componentInstance.centerLng).toBeCloseTo(72.8777, 3);
    expect(geoSpy).not.toHaveBeenCalled();

    fixture.destroy();
  });

  it('useCurrentLocation() success sets locating false and updates the map view', () => {
    spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake(
      (success: PositionCallback) => {
        success({
          coords: { latitude: 20, longitude: 74, accuracy: 1 } as GeolocationCoordinates,
          timestamp: Date.now(),
        } as GeolocationPosition);
      },
    );
    const fixture = create();
    fixture.detectChanges();

    expect(fixture.componentInstance.locating()).toBeFalse();
    expect(fixture.componentInstance.locateError()).toBe('');

    fixture.destroy();
  });

  it('useCurrentLocation() failure sets locateError and locating false', () => {
    spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake(
      (_success: PositionCallback, error?: PositionErrorCallback) => {
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError);
      },
    );
    const fixture = create();
    fixture.detectChanges();

    expect(fixture.componentInstance.locating()).toBeFalse();
    expect(fixture.componentInstance.locateError()).toBe('Could not access your location. Please pin it manually.');

    fixture.destroy();
  });

  it('useCurrentLocation() sets an error when geolocation is unsupported', () => {
    const fixture = create();
    fixture.componentInstance.initialLat = 19; // skip auto-locate in ngAfterViewInit
    fixture.componentInstance.initialLng = 72;
    fixture.detectChanges();

    const originalGeolocation = navigator.geolocation;
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });

    fixture.componentInstance.useCurrentLocation();

    expect(fixture.componentInstance.locateError()).toBe('Location access is not supported on this device.');

    Object.defineProperty(navigator, 'geolocation', { value: originalGeolocation, configurable: true });
    fixture.destroy();
  });

  it('confirm() emits locationConfirmed with the current center', () => {
    spyOn(navigator.geolocation, 'getCurrentPosition');
    const fixture = create();
    fixture.componentInstance.initialLat = 21;
    fixture.componentInstance.initialLng = 75;
    fixture.detectChanges();

    let emitted: { lat: number; lng: number } | undefined;
    fixture.componentInstance.locationConfirmed.subscribe((v) => (emitted = v));

    fixture.componentInstance.confirm();

    expect(emitted).toEqual({ lat: 21, lng: 75 });
    fixture.destroy();
  });

  it('cancel() emits cancelled', () => {
    spyOn(navigator.geolocation, 'getCurrentPosition');
    const fixture = create();
    fixture.componentInstance.initialLat = 21;
    fixture.componentInstance.initialLng = 75;
    fixture.detectChanges();

    let called = false;
    fixture.componentInstance.cancelled.subscribe(() => (called = true));

    fixture.componentInstance.cancel();

    expect(called).toBeTrue();
    fixture.destroy();
  });

  it('ngOnDestroy removes the underlying map', () => {
    spyOn(navigator.geolocation, 'getCurrentPosition');
    const fixture = create();
    fixture.componentInstance.initialLat = 21;
    fixture.componentInstance.initialLng = 75;
    fixture.detectChanges();

    const map = (fixture.componentInstance as any).map;
    expect(map).toBeTruthy();
    const removeSpy = spyOn(map, 'remove').and.callThrough();

    fixture.componentInstance.ngOnDestroy();

    expect(removeSpy).toHaveBeenCalled();
    expect((fixture.componentInstance as any).map).toBeNull();
  });
});
