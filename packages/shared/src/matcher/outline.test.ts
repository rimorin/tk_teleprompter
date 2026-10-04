import { describe, expect, it } from 'vitest';
import { normalizeSpokenText } from '../normalize';
import { findOutlineBullets } from '../outline';
import { parseScript } from '../tokenizer';
import { misrecognize } from '../sim/simulator';
import {
  FOUR_DAY_WEEK_OUTLINE,
  FOUR_DAY_WEEK_TALK,
  ONBOARDING_OUTLINE,
  ONBOARDING_TALK,
  type TalkSegment,
} from '../fixtures/outlines';
import { DEFAULT_MATCHER_CONFIG } from './config';
import {
  createOutlineContext,
  initialOutlineState,
  repositionOutline,
  tentativeOutlineBullet,
  updateOutline,
  type OutlineContext,
  type OutlineState,
} from './outline';

function outlineContext(source: string): OutlineContext {
  const script = parseScript(source);
  return createOutlineContext(
    script,
    findOutlineBullets(script, DEFAULT_MATCHER_CONFIG.outline.maxBulletWords),
  );
}

const onboarding = outlineContext(ONBOARDING_OUTLINE);
const fourDayWeek = outlineContext(FOUR_DAY_WEEK_OUTLINE);

type Result = {
  state: OutlineState;
  /** Bullet after each segment. */
  bullets: number[];
  /** Segments after which the tracker was on a later bullet than the speaker. */
  ahead: number;
  /** Per bullet change in the talk: segments until the tracker caught up (null: never did). */
  lags: Array<number | null>;
};

function run(ctx: OutlineContext, talk: TalkSegment[], from = initialOutlineState(ctx)): Result {
  let state = from;
  const bullets: number[] = [];
  const changes: number[] = [];
  talk.forEach(([truth, text], i) => {
    if (i > 0 && truth !== talk[i - 1]![0]) changes.push(i);
    state = updateOutline(ctx, state, normalizeSpokenText(text));
    bullets.push(state.bullet);
  });
  const ahead = bullets.filter((b, i) => b > talk[i]![0]).length;
  const lags = changes.map((start, c) => {
    const end = changes[c + 1] ?? talk.length;
    for (let i = start; i < end; i++) if (bullets[i]! >= talk[i]![0]) return i - start;
    return null;
  });
  return { state, bullets, ahead, lags };
}

const noisy = (talk: TalkSegment[], seed: number): TalkSegment[] => {
  const texts = misrecognize(
    talk.map(([, t]) => t),
    0.1,
    seed,
  );
  return talk.map(([b], i) => [b, texts[i]!]);
};

const caught = (r: Result) => r.lags.filter((l) => l !== null).length;

describe('outline tracking: talks given from an outline', () => {
  it('follows the onboarding talk without running ahead, at most two segments behind', () => {
    const r = run(onboarding, ONBOARDING_TALK);
    expect(r.ahead).toBe(0);
    expect(r.state.bullet).toBe(6);
    expect(caught(r)).toBeGreaterThanOrEqual(5); // of 6: "manual data migration" is never said
    expect(Math.max(...r.lags.map((l) => l ?? 0))).toBeLessThanOrEqual(2);
  });

  it('never runs ahead with 10% recognition errors', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = run(onboarding, noisy(ONBOARDING_TALK, seed));
      expect(r.ahead, `seed ${seed}`).toBe(0);
      expect(caught(r), `seed ${seed}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('follows a speaker who skips a bullet', () => {
    const r = run(
      onboarding,
      ONBOARDING_TALK.filter(([b]) => b !== 2),
    );
    expect(r.ahead).toBe(0);
    expect(r.lags.every((l) => l !== null && l <= 2)).toBe(true);
  });

  it('follows a talk it was not tuned on, from a speaker who comments more than voices', () => {
    const r = run(fourDayWeek, FOUR_DAY_WEEK_TALK);
    expect(r.ahead).toBe(0);
    expect(r.state.bullet).toBe(5);
    expect(caught(r)).toBeGreaterThanOrEqual(4); // of 5: "productivity held steady" is never said
  });

  it('catches up after two bullets in a row are only paraphrased', () => {
    const talk: TalkSegment[] = [
      [1, 'we sat down with twelve different teams over about a month'],
      [2, 'so why does it take so long'],
      [2, 'it is moving their old records across by hand'],
      [3, 'so we wrote a tool that does that part for you'],
      [3, 'and a shipping company tried it for a few weeks'],
      [4, 'and here is what happened'],
      [4, 'the setup went from three weeks to four days'],
      [4, 'and the number of support tickets they opened dropped a lot'],
      [4, 'our team noticed before we even told them'],
    ];
    const r = run(onboarding, talk, repositionOutline(onboarding, 1));
    expect(r.ahead).toBe(0);
    expect(r.state.bullet).toBe(4);
  });
});

describe('outline tracking: holding position', () => {
  it('stays put through a long tangent', () => {
    const tangent: TalkSegment[] = Array.from({ length: 20 }, () => [
      0,
      'my grandfather used to tell this story about the war and the farm',
    ]);
    const r = run(onboarding, tangent);
    expect(r.bullets.every((b) => b === 0)).toBe(true);
  });

  it('stays put when a tangent keeps repeating a word a later bullet has', () => {
    // "setup" is a keyword of bullets 1 and 4.
    const tangent: TalkSegment[] = Array.from({ length: 20 }, () => [
      0,
      'my old setup at home was a mess honestly',
    ]);
    const r = run(onboarding, tangent);
    expect(r.bullets.every((b) => b === 0)).toBe(true);
  });

  it('stays put when the speaker previews a later point, then carries on', () => {
    const r = run(onboarding, [
      [0, 'later I will show you how we piloted an importer with acme logistics'],
      [0, 'but first the problem which is that onboarding takes too long'],
      [0, 'it is just way too slow'],
    ]);
    expect(r.bullets).toEqual([0, 0, 0]);
  });

  it('is not moved by words every bullet shares', () => {
    const ctx = outlineContext(
      '- Pricing for teams\n- Pricing for schools\n- Pricing for charities',
    );
    const r = run(ctx, [[0, 'pricing pricing and more pricing']]);
    expect(r.bullets).toEqual([0]);
  });
});

describe('outline tracking: interims and manual moves', () => {
  it('suggests the next bullet from an interim without changing the state', () => {
    const state = initialOutlineState(onboarding);
    const words = normalizeSpokenText('so first we talked to customers twelve teams in all');
    expect(tentativeOutlineBullet(onboarding, state, words)).toBe(1);
    expect(state).toEqual(initialOutlineState(onboarding));
    const tangent = normalizeSpokenText('my grandfather used to tell this story');
    expect(tentativeOutlineBullet(onboarding, state, tangent)).toBeNull();
  });

  it('tracks on from a manual reposition, forward or back', () => {
    const forward = run(
      onboarding,
      [[5, 'we need two more engineers for the rollout']],
      repositionOutline(onboarding, 4),
    );
    expect(forward.bullets).toEqual([5]);
    const back = run(
      onboarding,
      [[2, 'it is moving their old records across by hand']],
      repositionOutline(onboarding, 2),
    );
    expect(back.bullets).toEqual([2]);
  });
});
