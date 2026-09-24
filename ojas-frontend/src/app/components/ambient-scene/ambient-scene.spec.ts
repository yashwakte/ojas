import { moodForPath, sceneProfile } from './ambient-scene';
import { moteField } from './scene-renderer';

describe('Ambient backdrop', () => {
  function fakeWindow(overrides: {
    saveData?: boolean;
    effectiveType?: string;
    deviceMemory?: number;
    reduced?: boolean;
    width?: number;
  }): Window {
    return {
      navigator: {
        connection: { saveData: overrides.saveData, effectiveType: overrides.effectiveType },
        deviceMemory: overrides.deviceMemory ?? 8,
        hardwareConcurrency: 8,
      },
      WebGLRenderingContext: function () {},
      innerWidth: overrides.width ?? 1440,
      matchMedia: (query: string) => ({
        matches: query.includes('reduced-motion') ? !!overrides.reduced : false,
      }),
    } as unknown as Window;
  }

  it('gives each part of the shop its own arrangement of the light', () => {
    expect(moodForPath('/')).toBe(0);
    expect(moodForPath('/products')).toBe(1);
    expect(moodForPath('/products/modak-pith')).toBe(2);
    expect(moodForPath('/cart')).toBe(3);
    expect(moodForPath('/checkout')).toBe(3);
  });

  it('stays off with Data Saver, on a slow connection, and on a low-memory phone', () => {
    expect(sceneProfile(fakeWindow({ saveData: true }))).toBeNull();
    expect(sceneProfile(fakeWindow({ effectiveType: '3g' }))).toBeNull();
    expect(sceneProfile(fakeWindow({ effectiveType: 'slow-2g' }))).toBeNull();
    expect(sceneProfile(fakeWindow({ deviceMemory: 1 }))).toBeNull();
  });

  it('draws a still frame for reduced motion, and fewer motes at 30 fps on a phone', () => {
    expect(sceneProfile(fakeWindow({ reduced: true }))?.still).toBeTrue();
    const phone = sceneProfile(fakeWindow({ width: 390 }))!;
    const desktop = sceneProfile(fakeWindow({ width: 1440, effectiveType: '4g' }))!;
    expect(phone.fps).toBe(30);
    expect(phone.motes).toBeLessThan(desktop.motes);
  });

  it('spreads the motes across the full width, in all three depth layers', () => {
    const field = moteField(900);
    let left = 0;
    let right = 0;
    const layers = [0, 0, 0];
    for (let i = 0; i < 900; i++) {
      const x = field[i * 4];
      const depth = field[i * 4 + 2];
      expect(Math.abs(x)).toBeLessThanOrEqual(1);
      if (x < -0.5) left++;
      if (x > 0.5) right++;
      layers[Math.min(2, Math.floor(depth * 2.6))]++;
    }
    // Both edges of the screen, not one margin.
    expect(left).toBeGreaterThan(150);
    expect(right).toBeGreaterThan(150);
    expect(layers.every((n) => n > 250)).toBeTrue();
  });

  it('draws the same field on every page load', () => {
    expect(Array.from(moteField(20))).toEqual(Array.from(moteField(20)));
  });
});
