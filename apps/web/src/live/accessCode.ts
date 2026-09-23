import { loadJson, saveJson } from '../storage';

const KEY = 'teleprompter.accessCode.v1';

/** Per-device convenience so the presenter isn't asked for the access code every time. */
export function loadAccessCode(): string {
  return loadJson<string>(KEY) ?? '';
}

export function saveAccessCode(code: string): void {
  saveJson(KEY, code);
}
