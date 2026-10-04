import { useSyncExternalStore } from 'react';
import type { ResolvedTheme, Theme } from './settings';

const QUERY = '(prefers-color-scheme: light)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia?.(QUERY);
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

const prefersLight = () => window.matchMedia?.(QUERY).matches ?? false;

/** The theme to paint: 'system' becomes the device's current appearance, and follows changes. */
export function useResolvedTheme(theme: Theme): ResolvedTheme {
  const light = useSyncExternalStore(subscribe, prefersLight);
  return theme === 'system' ? (light ? 'light' : 'dark') : theme;
}
