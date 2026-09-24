import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultSettingsFor, sanitizeSettings } from './settings';

describe('settings', () => {
  it('sizes first-run defaults to the device', () => {
    expect(defaultSettingsFor(390)).toMatchObject({ fontSizePx: 30, readingZone: 0.25 });
    expect(defaultSettingsFor(820)).toMatchObject({ fontSizePx: 38, readingZone: 0.3 });
    expect(defaultSettingsFor(1440)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps saved values, clamps bad ones, and fills gaps from the device defaults', () => {
    const phone = defaultSettingsFor(390);
    expect(sanitizeSettings({ fontSizePx: 999, theme: 'light' }, phone)).toMatchObject({
      fontSizePx: 120,
      theme: 'light',
      readingZone: 0.25,
    });
    expect(sanitizeSettings({ theme: 'neon' as never }, phone).theme).toBe('dark');
    // The high-contrast theme was removed; a saved choice falls back to the default.
    expect(sanitizeSettings({ theme: 'contrast' as never }, phone).theme).toBe('dark');
  });
});
