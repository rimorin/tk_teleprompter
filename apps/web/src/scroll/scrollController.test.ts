import { describe, expect, it } from 'vitest';
import { planScroll, type ScrollPlanInput } from './scrollController';

const base: ScrollPlanInput = {
  targetCenter: 1000,
  viewportHeight: 600,
  scrollTop: 800,
  maxScrollTop: 5000,
  readingZone: 1 / 3,
  lineHeightPx: 60,
  deadbandLines: 0.6,
};

describe('planScroll', () => {
  it('scrolls so the target line centers on the reading zone', () => {
    expect(planScroll({ ...base, scrollTop: 0 })).toBe(800);
  });

  it('does not scroll for tiny changes within the dead band', () => {
    expect(planScroll({ ...base, targetCenter: 1020 })).toBeNull();
    expect(planScroll({ ...base, targetCenter: 1030 })).toBeNull();
  });

  it('scrolls when the target moves to the next line', () => {
    expect(planScroll({ ...base, targetCenter: 1060 })).toBe(860);
  });

  it('clamps to the scrollable range', () => {
    expect(planScroll({ ...base, targetCenter: 50, scrollTop: 300 })).toBe(0);
    expect(planScroll({ ...base, targetCenter: 99999, maxScrollTop: 4000 })).toBe(4000);
  });

  it('forces a re-center when the dead band is zero', () => {
    expect(planScroll({ ...base, targetCenter: 1010, deadbandLines: 0 })).toBe(810);
  });
});
