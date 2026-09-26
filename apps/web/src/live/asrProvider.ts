import type { HealthResponse } from '@teleprompter/shared';
import { loadJson, saveJson } from '../storage';

const KEY = 'teleprompter.asrProvider.v1';

const DISPLAY_NAMES: Record<string, string> = { deepgram: 'Deepgram', assemblyai: 'AssemblyAI' };

export function providerDisplayName(name: string): string {
  return DISPLAY_NAMES[name] ?? name;
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
