import { loadJson, saveJson } from './storage';

export type Theme = 'dark' | 'light';
export type Typeface = 'sans' | 'serif';

export type PresenterSettings = {
  fontSizePx: number;
  lineHeight: number;
  theme: Theme;
  /** Vertical position of the reading zone as a fraction of the viewport height. */
  readingZone: number;
  /** Text column width in em. */
  columnWidthEm: number;
  typeface: Typeface;
  mirrored: boolean;
};

export const SETTINGS_LIMITS = {
  fontSizePx: { min: 18, max: 120, step: 2 },
  lineHeight: { min: 1.1, max: 2.2, step: 0.1 },
  readingZone: { min: 0.1, max: 0.7, step: 0.05 },
  columnWidthEm: { min: 18, max: 60, step: 2 },
} as const;

export const DEFAULT_SETTINGS: PresenterSettings = {
  fontSizePx: 44,
  lineHeight: 1.5,
  theme: 'dark',
  readingZone: 0.33,
  columnWidthEm: 30,
  typeface: 'sans',
  mirrored: false,
};

/**
 * First-run defaults sized to the device: phones read at arm's length on a narrow screen with the
 * camera at the top, so text is smaller and the reading line sits higher (closer to the lens).
 */
export function defaultSettingsFor(viewportWidth: number): PresenterSettings {
  if (viewportWidth < 600) return { ...DEFAULT_SETTINGS, fontSizePx: 30, readingZone: 0.25 };
  if (viewportWidth < 1024) return { ...DEFAULT_SETTINGS, fontSizePx: 38, readingZone: 0.3 };
  return DEFAULT_SETTINGS;
}

const STORAGE_KEY = 'teleprompter.settings.v1';
const THEMES: Theme[] = ['dark', 'light'];
const TYPEFACES: Typeface[] = ['sans', 'serif'];

function clamp(n: unknown, { min, max }: { min: number; max: number }, fallback: number) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function sanitizeSettings(
  value: Partial<PresenterSettings> | undefined,
  defaults: PresenterSettings = DEFAULT_SETTINGS,
): PresenterSettings {
  const v = value ?? {};
  return {
    fontSizePx: clamp(v.fontSizePx, SETTINGS_LIMITS.fontSizePx, defaults.fontSizePx),
    lineHeight: clamp(v.lineHeight, SETTINGS_LIMITS.lineHeight, defaults.lineHeight),
    readingZone: clamp(v.readingZone, SETTINGS_LIMITS.readingZone, defaults.readingZone),
    columnWidthEm: clamp(v.columnWidthEm, SETTINGS_LIMITS.columnWidthEm, defaults.columnWidthEm),
    theme: THEMES.includes(v.theme as Theme) ? (v.theme as Theme) : defaults.theme,
    typeface: TYPEFACES.includes(v.typeface as Typeface)
      ? (v.typeface as Typeface)
      : defaults.typeface,
    mirrored: typeof v.mirrored === 'boolean' ? v.mirrored : defaults.mirrored,
  };
}

export function loadSettings(): PresenterSettings {
  return sanitizeSettings(
    loadJson<Partial<PresenterSettings>>(STORAGE_KEY),
    defaultSettingsFor(window.innerWidth),
  );
}

export function saveSettings(settings: PresenterSettings): void {
  saveJson(STORAGE_KEY, settings);
}
