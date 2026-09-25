import { useEffect } from 'react';

type WakeLockSentinelLike = { release: () => Promise<void>; released: boolean };

/**
 * Keep the screen on while presenting (phones dim and lock after ~30 s of no touches, which
 * would also stop the microphone). The lock is dropped by the browser when the page is hidden,
 * so it is re-acquired when the page becomes visible again. No-op where unsupported.
 */
export function useWakeLock(): void {
  useEffect(() => {
    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
      }
    ).wakeLock;
    if (!wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        sentinel = await wakeLock.request('screen');
        if (cancelled) void sentinel.release();
      } catch {
        // Denied (e.g. battery saver) — presenting still works, the screen may just dim.
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release().catch(() => {});
    };
  }, []);
}
