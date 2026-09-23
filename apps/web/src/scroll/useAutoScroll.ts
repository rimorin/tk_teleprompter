import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { planScroll, SCROLL_DEADBAND_LINES, ScrollAnimator } from './scrollController';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(REDUCED_MOTION);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

type Options = {
  readingZone: number;
  lineHeightPx: number;
  /** Changes whenever layout changes (font size, zone, ...) to force an instant re-center. */
  layoutKey: string;
};

/**
 * Keeps the focus token's line on the reading zone. Runs only when the focus token or layout
 * changes, independently of how often recognition updates arrive.
 */
export function useAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  focusTokenId: number | null,
  { readingZone, lineHeightPx, layoutKey }: Options,
) {
  const animatorRef = useRef<ScrollAnimator | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const animator = new ScrollAnimator(el);
    animatorRef.current = animator;
    // Any direct user scrolling takes precedence over an in-flight animation.
    const cancel = () => animator.cancel();
    el.addEventListener('wheel', cancel, { passive: true });
    el.addEventListener('touchstart', cancel, { passive: true });
    el.addEventListener('mousedown', cancel);
    return () => {
      animator.cancel();
      el.removeEventListener('wheel', cancel);
      el.removeEventListener('touchstart', cancel);
      el.removeEventListener('mousedown', cancel);
      animatorRef.current = null;
    };
  }, [containerRef]);

  const scrollToFocus = useCallback(
    (deadbandLines: number, instant: boolean) => {
      const el = containerRef.current;
      if (!el || focusTokenId === null) return;
      const tokenEl = el.querySelector<HTMLElement>(`[data-tid="${focusTokenId}"]`);
      if (!tokenEl) return;
      const elRect = el.getBoundingClientRect();
      const tokRect = tokenEl.getBoundingClientRect();
      const top = planScroll({
        targetCenter: tokRect.top - elRect.top + el.scrollTop + tokRect.height / 2,
        viewportHeight: el.clientHeight,
        scrollTop: el.scrollTop,
        maxScrollTop: el.scrollHeight - el.clientHeight,
        readingZone,
        lineHeightPx,
        deadbandLines,
      });
      if (top !== null) animatorRef.current?.scrollTo(top, instant || reducedMotion);
    },
    [containerRef, focusTokenId, readingZone, lineHeightPx, reducedMotion],
  );

  // Focus moved: ease toward it, ignoring micro-moves.
  useLayoutEffect(() => {
    scrollToFocus(SCROLL_DEADBAND_LINES, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTokenId]);

  // Layout changed: re-center immediately.
  useLayoutEffect(() => {
    scrollToFocus(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  useEffect(() => {
    const onResize = () => scrollToFocus(0, true);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scrollToFocus]);
}
