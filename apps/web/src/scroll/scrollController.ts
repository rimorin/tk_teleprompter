export type ScrollPlanInput = {
  /** Target line's vertical center, in scroll-content coordinates. */
  targetCenter: number;
  viewportHeight: number;
  scrollTop: number;
  maxScrollTop: number;
  /** Reading zone position as a fraction of the viewport height. */
  readingZone: number;
  lineHeightPx: number;
  /** Ignore moves smaller than this many line heights. */
  deadbandLines: number;
};

/** Moves under 0.6 lines don't scroll. */
export const SCROLL_DEADBAND_LINES = 0.6;
/** Time constant for the exponential ease toward the target. */
const SCROLL_TAU_MS = 160;

/**
 * Decide where to scroll so the target line sits on the reading zone. Returns null when the
 * change is below the dead band.
 */
export function planScroll(input: ScrollPlanInput): number | null {
  const desired = Math.round(
    Math.min(
      input.maxScrollTop,
      Math.max(0, input.targetCenter - input.readingZone * input.viewportHeight),
    ),
  );
  if (Math.abs(desired - input.scrollTop) < input.deadbandLines * input.lineHeightPx) return null;
  return desired;
}

/**
 * Eases an element's scrollTop toward a target using requestAnimationFrame. Tracks its own
 * floating-point position so rounding by the browser can't stall the animation.
 */
export class ScrollAnimator {
  private target: number | null = null;
  private pos = 0;
  private frame: number | null = null;
  private lastTime = 0;

  constructor(private readonly el: HTMLElement) {}

  scrollTo(top: number, instant: boolean): void {
    if (instant) {
      this.cancel();
      this.el.scrollTop = top;
      return;
    }
    if (this.frame === null) {
      this.pos = this.el.scrollTop;
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame(this.step);
    }
    this.target = top;
  }

  cancel(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.target = null;
  }

  private step = (now: number) => {
    if (this.target === null) return;
    const dt = Math.min(64, now - this.lastTime);
    this.lastTime = now;
    const diff = this.target - this.pos;
    if (Math.abs(diff) < 0.5) {
      this.el.scrollTop = this.target;
      this.frame = null;
      this.target = null;
      return;
    }
    this.pos += diff * (1 - Math.exp(-dt / SCROLL_TAU_MS));
    this.el.scrollTop = this.pos;
    this.frame = requestAnimationFrame(this.step);
  };
}
