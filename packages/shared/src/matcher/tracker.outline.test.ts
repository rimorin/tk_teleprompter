import { describe, expect, it } from 'vitest';
import { parseScript } from '../tokenizer';
import type { TranscriptEvent } from '../types';
import {
  MIXED_CLOSING,
  MIXED_OPENING,
  MIXED_SCRIPT,
  ONBOARDING_OUTLINE,
  ONBOARDING_TALK,
  type TalkSegment,
} from '../fixtures/outlines';
import { createMatchContext } from './context';
import {
  initialTrackingState,
  reposition,
  startTracking,
  update,
  type TrackingState,
} from './tracker';

/** Where the speaker truly is: on an outline bullet, or having read up to a token of prose. */
type Truth = { bullet: number } | { tokenId: number };
type Step = { event: TranscriptEvent; truth: Truth };

let order = 0;
/** One final per segment, preceded by interims every two words, as a provider would send. */
function events(segments: Array<[Truth, string]>): Step[] {
  const out: Step[] = [];
  for (const [truth, text] of segments) {
    const words = text.split(' ');
    const seg = { sessionId: 's', segmentId: `g${order}`, segmentOrder: order++ };
    for (let n = 2; n < words.length; n += 2) {
      out.push({
        truth,
        event: {
          ...seg,
          kind: 'interim',
          text: words.slice(0, n).join(' '),
          sequence: order * 100 + n,
        },
      });
    }
    out.push({ truth, event: { ...seg, kind: 'final', text, sequence: order * 100 + 99 } });
  }
  return out;
}

const talk = (segments: TalkSegment[]): Array<[Truth, string]> =>
  segments.map(([bullet, text]) => [{ bullet }, text]);

/** Prose read word for word in finals of eight words; truth is the last token read. */
function read(script: ReturnType<typeof parseScript>, text: string): Array<[Truth, string]> {
  const start = script.source.indexOf(text);
  const tokens = script.tokens.filter(
    (t) => t.startOffset >= start && t.endOffset <= start + text.length,
  );
  const out: Array<[Truth, string]> = [];
  for (let i = 0; i < tokens.length; i += 8) {
    const chunk = tokens.slice(i, i + 8);
    out.push([{ tokenId: chunk[chunk.length - 1]!.id }, chunk.map((t) => t.displayText).join(' ')]);
  }
  return out;
}

function setup(source: string) {
  const script = parseScript(source);
  const ctx = createMatchContext(script);
  const run = ctx.outlines[0]!;
  const bullets = run.outline.bullets;
  /** Last token the speaker could be at while on `bullet` (the cursor must not pass it). */
  const limit = (t: Truth) =>
    'tokenId' in t
      ? t.tokenId
      : t.bullet + 1 < bullets.length
        ? bullets[t.bullet + 1]!.startTokenId - 1
        : run.lastTokenId;
  /** Bullet the reading focus is on, or null outside the outline. */
  const bulletAt = (s: TrackingState) => {
    const focus = (s.confirmedTokenId ?? -1) + 1;
    if (focus < run.startTokenId || focus > run.lastTokenId) return null;
    return bullets.findLastIndex((b) => b.startTokenId <= focus);
  };
  return { script, ctx, run, bullets, limit, bulletAt };
}

function play(
  ctx: ReturnType<typeof createMatchContext>,
  steps: Step[],
  from = startTracking(initialTrackingState()),
) {
  let state = from;
  const history: Array<{ step: Step; state: TrackingState; prev: TrackingState }> = [];
  for (const step of steps) {
    const prev = state;
    state = update(ctx, state, step.event);
    history.push({ step, state, prev });
  }
  return { state, history };
}

describe('tracker: following an outline', () => {
  const { ctx, bullets, limit, bulletAt } = setup(ONBOARDING_OUTLINE);

  it('follows a talk bullet by bullet from transcript events, never ahead of the speaker', () => {
    const { state, history } = play(ctx, events(talk(ONBOARDING_TALK)));
    for (const { step, state: s, prev } of history) {
      expect(s.confirmedTokenId ?? -1).toBeLessThanOrEqual(limit(step.truth));
      expect(s.confirmedTokenId ?? -1).toBeGreaterThanOrEqual(prev.confirmedTokenId ?? -1);
      if (step.event.kind === 'interim') expect(s.confirmedTokenId).toBe(prev.confirmedTokenId);
      if (s.tentativeTokenId !== null)
        expect(s.tentativeTokenId).toBeGreaterThan(s.confirmedTokenId ?? -1);
      expect(s.status).toBe('tracking');
    }
    expect(bulletAt(state)).toBe(bullets.length - 1);
    // The cursor sits just before the current bullet, so the reading focus is on it.
    expect(state.confirmedTokenId).toBe(bullets[bullets.length - 1]!.startTokenId - 1);
  });

  it('shows the next bullet from interims before the final arrives', () => {
    const { history } = play(
      ctx,
      events([[{ bullet: 1 }, 'so first we talked to customers twelve different teams in all']]),
    );
    const interims = history.filter((h) => h.step.event.kind === 'interim');
    expect(interims.some((h) => h.state.tentativeTokenId === bullets[1]!.startTokenId - 1)).toBe(
      true,
    );
    expect(interims.every((h) => h.state.confirmedTokenId === null)).toBe(true);
  });

  it('becomes uncertain only after a long stretch with no keyword, and recovers', () => {
    const tangent: Array<[Truth, string]> = Array.from({ length: 12 }, () => [
      { bullet: 0 },
      'my grandfather used to tell this story about the war and the farm',
    ]);
    const { history } = play(ctx, events([...tangent, ...talk(ONBOARDING_TALK.slice(7, 9))]));
    const finals = history.filter((h) => h.step.event.kind === 'final');
    expect(finals.slice(0, 5).every((h) => h.state.status === 'tracking')).toBe(true);
    expect(finals[11]!.state.status).toBe('uncertain');
    expect(finals[13]!.state.status).toBe('tracking');
    expect(bulletAt(finals[13]!.state)).toBe(1);
  });

  it('tracks on from a tap on any bullet, forward or back', () => {
    const tapped = reposition(startTracking(initialTrackingState()), bullets[4]!.firstTokenId);
    const { state } = play(
      ctx,
      events([[{ bullet: 5 }, 'so we need two more engineers for the rollout']]),
      tapped,
    );
    expect(bulletAt(state)).toBe(5);
    const back = reposition(state, bullets[2]!.startTokenId);
    const after = play(
      ctx,
      events([[{ bullet: 2 }, 'it is moving their old records across by hand']]),
      back,
    );
    expect(after.state.confirmedTokenId).toBe(bullets[2]!.startTokenId - 1);
  });
});

describe('tracker: a script mixing prose and an outline', () => {
  const { script, ctx, run, limit, bulletAt } = setup(MIXED_SCRIPT);
  const outlineTalk = talk(ONBOARDING_TALK.filter(([b]) => b <= 5));

  it('reads the prose, follows the outline, then reads the closing prose', () => {
    const steps = events([
      ...read(script, MIXED_OPENING),
      ...outlineTalk,
      ...read(script, MIXED_CLOSING),
    ]);
    const { state, history } = play(ctx, steps);
    for (const { step, state: s } of history) {
      expect(s.confirmedTokenId ?? -1, step.event.text).toBeLessThanOrEqual(limit(step.truth));
    }
    // The outline took over once the opening was read, and handed back for the closing.
    const firstOutline = history.findIndex((h) => 'bullet' in h.step.truth);
    expect(bulletAt(history[firstOutline]!.state)).toBe(0);
    expect(history.some((h) => bulletAt(h.state) === 5)).toBe(true);
    expect(state.outline).toBeNull();
    expect(state.confirmedTokenId).toBeGreaterThanOrEqual(script.tokens.length - 3);
  });

  it('stays in the outline when the speaker quotes the closing, then carries on', () => {
    const steps = events([
      ...read(script, MIXED_OPENING),
      ...outlineTalk.slice(0, 9),
      [{ bullet: 1 }, 'like I always say listen to the people who leave'],
      [{ bullet: 1 }, 'and the thing almost every team told us'],
      [{ bullet: 1 }, 'is that it took them roughly three weeks before they were live'],
    ]);
    const { state, history } = play(ctx, steps);
    for (const { step, state: s } of history) {
      expect(s.confirmedTokenId ?? -1, step.event.text).toBeLessThanOrEqual(limit(step.truth));
    }
    expect(bulletAt(state)).toBe(1);
    expect(state.confirmedTokenId).toBeLessThan(run.lastTokenId);
  });
});
