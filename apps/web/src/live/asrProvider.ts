import type { HealthResponse } from '@teleprompter/shared';
import { loadJson, saveJson } from '../storage';

const KEY = 'teleprompter.asrProvider.v1';

/** Presenters choose by what a service is better at; the vendor is small print. */
const DESCRIPTIONS: Record<string, { label: string; detail: string; vendor: string }> = {
  assemblyai: {
    label: 'Fastest',
    detail: 'Words are confirmed about a second sooner. Uses more data on older browsers.',
    vendor: 'AssemblyAI',
  },
  deepgram: {
    label: 'Standard',
    detail: 'Uses less data on older browsers; the same on current Safari and Chrome.',
    vendor: 'Deepgram',
  },
};

export function describeProvider(name: string): { label: string; detail: string; vendor: string } {
  return DESCRIPTIONS[name] ?? { label: name, detail: '', vendor: name };
}

/** Per-device choice of speech provider, when the server offers more than one. */
export function loadProviderChoice(): string | null {
  return loadJson<string>(KEY) ?? null;
}

export function saveProviderChoice(name: string): void {
  saveJson(KEY, name);
}

export type OfferedProvider = NonNullable<HealthResponse['asr']['providers']>[number];

/**
 * The saved choice when the server still offers it, otherwise the server's default. Undefined
 * for older servers, which offer no choice.
 */
export function resolveProvider(
  offered: OfferedProvider[] = [],
  saved: string | null,
): OfferedProvider | undefined {
  return offered.find((p) => p.name === saved) ?? offered[0];
}
