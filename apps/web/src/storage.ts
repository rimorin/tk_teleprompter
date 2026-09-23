/**
 * Browser storage is a convenience only: it may be unavailable (private mode, blocked site data),
 * so every access is guarded and callers must work without it.
 */
export function loadJson<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota or access errors.
  }
}
