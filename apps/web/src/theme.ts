import { useSyncExternalStore } from 'react';
import type { Theme, ThemeName } from './settings';

const QUERY = '(prefers-color-scheme: light)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia?.(QUERY);
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

const prefersLight = () => window.matchMedia?.(QUERY).matches ?? false;

/** The theme to paint: 'system' becomes Graphite or Daylight to match the device, and follows changes. */
export function useResolvedTheme(theme: Theme): ThemeName {
  const light = useSyncExternalStore(subscribe, prefersLight);
  if (theme !== 'system') return theme;
  return light ? 'daylight' : 'graphite';
}
