import type { AudioFormat, HealthResponse } from '@teleprompter/shared';
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

/**
 * The provider a session should use: the saved choice when the server still offers it,
 * otherwise the server's default. `name` is undefined for older servers that offer no choice.
 */
export function resolveProvider(
  asr: HealthResponse['asr'],
  saved: string | null,
): { name: string | undefined; encodings: AudioFormat['encoding'][] } {
  const offered = asr.providers ?? [];
  const chosen = offered.find((p) => p.name === saved) ?? offered[0];
  if (chosen) return { name: chosen.name, encodings: chosen.encodings };
  return { name: undefined, encodings: asr.encodings ?? ['linear16', 'opus'] };
}
