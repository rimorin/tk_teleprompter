import { useEffect, useState } from 'react';

/** Mouse/trackpad devices. On touch screens a tap can't both reveal controls and jump to a word. */
function hasFinePointer(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

/**
 * True after `ms` without pointer or keyboard activity, while `enabled`, on mouse/trackpad
 * devices only. Used to fade the presenter controls out of the way during a session.
 */
export function useIdle(enabled: boolean, ms = 3000): boolean {
  const [idle, setIdle] = useState(false);
  const on = enabled && hasFinePointer();
  useEffect(() => {
    if (!on) return;
    let timer = setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), ms);
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
      setIdle(false);
    };
  }, [on, ms]);
  return on && idle;
}
