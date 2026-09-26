import { TestBed } from '@angular/core/testing';
import { Msg91WidgetService } from './msg91-widget.service';
import { environment } from '../../environments/environment';
import { environment as productionEnvironment } from '../../environments/environment.prod';

/** The unit tests build with the development environment, where the local test mode is on - the
 * same mode a developer's `ng serve` runs in, since MSG91 cannot send a text from localhost. */
describe('Msg91WidgetService (local test mode)', () => {
  let service: Msg91WidgetService;

  beforeEach(() => {
    service = TestBed.inject(Msg91WidgetService);
  });

  it('is switched on in the development environment and off in production', () => {
    expect(environment.msg91DevBypassCode).toBe('1234');
    expect(productionEnvironment.msg91DevBypassCode).toBeNull();
  });

  it('never loads MSG91 or sends a text', async () => {
    await service.initialize();
    await service.sendOtp('9876543210');
    expect(document.getElementById('msg91-otp-widget-script')).toBeNull();
  });

  it('turns the test code into a token for the number it was sent to, fresh each time', async () => {
    await service.sendOtp('9876543210');
    const first = await service.verifyOtp('1234');
    const second = await service.verifyOtp('1234');

    expect(first.startsWith('ojas-dev-otp:9876543210:')).toBeTrue();
    expect(second).not.toBe(first);
  });

  it('refuses any other code', async () => {
    await service.sendOtp('9876543210');
    await expectAsync(service.verifyOtp('9999')).toBeRejected();
  });
});
