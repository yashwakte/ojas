import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { DeliveryChargesManagement } from './delivery-charges-management';
import { DeliveryChargesService } from '../../services/delivery-charges.service';
import { DeliveryChargesConfig } from '../../models/interfaces';

describe('DeliveryChargesManagement', () => {
  const config: DeliveryChargesConfig = {
    id: 'c1',
    warehouseAddress: 'Sangvi, Pune, Maharashtra',
    warehouseLatitude: 18.5672,
    warehouseLongitude: 73.7793,
    freeDeliveryUpToKm: 7,
    perKmChargeAfterFree: 10,
    isActive: true,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  let configSignal: ReturnType<typeof signal<DeliveryChargesConfig | null>>;
  let deliveryChargesServiceSpy: any;

  beforeEach(() => {
    configSignal = signal<DeliveryChargesConfig | null>(null);
    deliveryChargesServiceSpy = jasmine.createSpyObj(
      'DeliveryChargesService',
      ['loadConfig', 'updateConfig', 'calculateDeliveryCharge'],
      { config: configSignal, loading: signal(false), error: signal<string | null>(null) },
    );
    deliveryChargesServiceSpy.calculateDeliveryCharge.and.returnValue({
      charge: 0,
      isFree: true,
      breakdown: 'Free delivery',
    });

    TestBed.configureTestingModule({
      imports: [DeliveryChargesManagement],
      providers: [{ provide: DeliveryChargesService, useValue: deliveryChargesServiceSpy }],
    });
  });

  // MatSnackBarModule declares its own `providers: [MatSnackBar]` pulled into this standalone
  // component's own injector, shadowing a TestBed-level override - spy on the real instance.
  function create() {
    const fixture = TestBed.createComponent(DeliveryChargesManagement);
    fixture.detectChanges();
    const snackBar = fixture.debugElement.injector.get(MatSnackBar);
    spyOn(snackBar, 'open').and.stub();
    return { fixture, snackBar };
  }

  it('calls loadConfig on init', () => {
    const { fixture } = create();
    expect(deliveryChargesServiceSpy.loadConfig).toHaveBeenCalled();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('syncs formData from config when not editing', () => {
    const { fixture } = create();
    configSignal.set(config);
    TestBed.flushEffects();

    expect(fixture.componentInstance.formData()).toEqual({
      warehouseAddress: config.warehouseAddress,
      warehouseLatitude: config.warehouseLatitude,
      warehouseLongitude: config.warehouseLongitude,
      freeDeliveryUpToKm: config.freeDeliveryUpToKm,
      perKmChargeAfterFree: config.perKmChargeAfterFree,
      isActive: config.isActive,
    });
  });

  it('does not overwrite formData from config while editing', () => {
    const { fixture } = create();
    configSignal.set(config);
    TestBed.flushEffects();
    fixture.componentInstance.startEditing();
    fixture.componentInstance.formData.update((d) => ({ ...d, freeDeliveryUpToKm: 99 }));

    configSignal.set({ ...config, freeDeliveryUpToKm: 5 });
    TestBed.flushEffects();

    expect(fixture.componentInstance.formData().freeDeliveryUpToKm).toBe(99);
  });

  it('startEditing sets editing true and clears form errors', () => {
    const { fixture } = create();
    fixture.componentInstance.startEditing();
    expect(fixture.componentInstance.editing()).toBeTrue();
  });

  it('cancelEditing resets the form from config and exits editing mode', () => {
    const { fixture } = create();
    configSignal.set(config);
    TestBed.flushEffects();
    fixture.componentInstance.startEditing();
    fixture.componentInstance.formData.update((d) => ({ ...d, freeDeliveryUpToKm: 99 }));

    fixture.componentInstance.cancelEditing();

    expect(fixture.componentInstance.editing()).toBeFalse();
    expect(fixture.componentInstance.formData().freeDeliveryUpToKm).toBe(7);
  });

  it('validateForm flags out-of-range latitude/longitude/km/charge values', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.set({
      warehouseAddress: 'ok address',
      warehouseLatitude: 200,
      warehouseLongitude: -200,
      freeDeliveryUpToKm: -1,
      perKmChargeAfterFree: -5,
      isActive: true,
    });

    expect(fixture.componentInstance.validateForm()).toBeFalse();
    expect(fixture.componentInstance.hasError('warehouseLatitude')).toBeTrue();
    expect(fixture.componentInstance.hasError('warehouseLongitude')).toBeTrue();
    expect(fixture.componentInstance.hasError('freeDeliveryUpToKm')).toBeTrue();
    expect(fixture.componentInstance.hasError('perKmChargeAfterFree')).toBeTrue();
  });

  it('validateForm requires a warehouse address of at least 5 characters', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.set({ warehouseAddress: 'a' });
    expect(fixture.componentInstance.validateForm()).toBeFalse();
    expect(fixture.componentInstance.hasError('warehouseAddress')).toBeTrue();
  });

  it('validateForm passes for a fully valid form', () => {
    const { fixture } = create();
    fixture.componentInstance.formData.set({
      warehouseAddress: 'Valid Address, City',
      warehouseLatitude: 18.5,
      warehouseLongitude: 73.8,
      freeDeliveryUpToKm: 7,
      perKmChargeAfterFree: 10,
      isActive: true,
    });
    expect(fixture.componentInstance.validateForm()).toBeTrue();
  });

  it('saveConfig shows an error and skips the service call when the form is invalid', () => {
    const { fixture, snackBar } = create();
    fixture.componentInstance.formData.set({ warehouseAddress: 'a' });

    fixture.componentInstance.saveConfig();

    expect(snackBar.open).toHaveBeenCalledWith('Please fix the validation errors', 'Close', jasmine.any(Object));
    expect(deliveryChargesServiceSpy.updateConfig).not.toHaveBeenCalled();
  });

  it('saveConfig sanitizes values, updates config, exits editing, and shows success', () => {
    deliveryChargesServiceSpy.updateConfig.and.returnValue(of(config));
    const { fixture, snackBar } = create();
    fixture.componentInstance.startEditing();
    fixture.componentInstance.formData.set({
      warehouseAddress: '  Valid Address  ',
      warehouseLatitude: 18.567199,
      warehouseLongitude: 73.779311,
      freeDeliveryUpToKm: 7.05,
      perKmChargeAfterFree: 10.005,
      isActive: true,
    });

    fixture.componentInstance.saveConfig();

    expect(deliveryChargesServiceSpy.updateConfig).toHaveBeenCalledWith(
      jasmine.objectContaining({ warehouseAddress: 'Valid Address', freeDeliveryUpToKm: 7.1 }),
    );
    expect(snackBar.open).toHaveBeenCalledWith(
      'Delivery charges configuration updated successfully',
      'Close',
      jasmine.any(Object),
    );
    expect(fixture.componentInstance.editing()).toBeFalse();
    expect(fixture.componentInstance.submitting()).toBeFalse();
  });

  it('saveConfig shows an error message when the update fails', () => {
    deliveryChargesServiceSpy.updateConfig.and.returnValue(
      throwError(() => ({ error: { message: 'Server rejected' } })),
    );
    const { fixture, snackBar } = create();
    fixture.componentInstance.formData.set({
      warehouseAddress: 'Valid Address',
      warehouseLatitude: 18.5,
      warehouseLongitude: 73.8,
      freeDeliveryUpToKm: 7,
      perKmChargeAfterFree: 10,
      isActive: true,
    });

    fixture.componentInstance.saveConfig();

    expect(snackBar.open).toHaveBeenCalledWith('Server rejected', 'Close', jasmine.any(Object));
    expect(fixture.componentInstance.submitting()).toBeFalse();
  });

  it('toggleActive updates isActive and triggers a save', () => {
    deliveryChargesServiceSpy.updateConfig.and.returnValue(of(config));
    const { fixture } = create();
    fixture.componentInstance.formData.set({
      warehouseAddress: 'Valid Address',
      warehouseLatitude: 18.5,
      warehouseLongitude: 73.8,
      freeDeliveryUpToKm: 7,
      perKmChargeAfterFree: 10,
      isActive: false,
    });

    fixture.componentInstance.toggleActive({ checked: true });

    expect(fixture.componentInstance.formData().isActive).toBeTrue();
    expect(deliveryChargesServiceSpy.updateConfig).toHaveBeenCalled();
  });

  it('isFreeDelivery treats missing/inactive config as always free', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.isFreeDelivery(100)).toBeTrue();

    configSignal.set({ ...config, isActive: false });
    TestBed.flushEffects();
    expect(fixture.componentInstance.isFreeDelivery(100)).toBeTrue();
  });

  it('isFreeDelivery compares distance against the configured free radius', () => {
    const { fixture } = create();
    configSignal.set(config);
    TestBed.flushEffects();
    expect(fixture.componentInstance.isFreeDelivery(5)).toBeTrue();
    expect(fixture.componentInstance.isFreeDelivery(10)).toBeFalse();
  });

  it('calculateCharge / getBreakdown delegate to the service', () => {
    deliveryChargesServiceSpy.calculateDeliveryCharge.and.returnValue({
      charge: 30,
      isFree: false,
      breakdown: 'some breakdown',
    });
    const { fixture } = create();
    expect(fixture.componentInstance.calculateCharge(10)).toBe(30);
    expect(fixture.componentInstance.getBreakdown(10)).toBe('some breakdown');
  });

  it('testDistanceCalculation stores the result and clearTest resets it', () => {
    deliveryChargesServiceSpy.calculateDeliveryCharge.and.returnValue({
      charge: 15,
      isFree: false,
      breakdown: 'x',
    });
    const { fixture } = create();

    fixture.componentInstance.testDistanceCalculation(12);

    expect(fixture.componentInstance.testDistance()).toBe(12);
    expect(fixture.componentInstance.testResult()).toEqual({ charge: 15, isFree: false, breakdown: 'x' });

    fixture.componentInstance.clearTest();
    expect(fixture.componentInstance.testDistance()).toBeNull();
    expect(fixture.componentInstance.testResult()).toBeNull();
  });

  it('formatCoordinate formats to 6 decimal places', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.formatCoordinate(18.5)).toBe('18.500000');
  });
});
