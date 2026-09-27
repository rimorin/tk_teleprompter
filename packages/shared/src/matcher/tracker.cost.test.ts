import { describe, expect, it, vi } from 'vitest';
import { parseScript } from '../tokenizer';
import { TALK_SCRIPT } from '../fixtures/scripts';
import { createMatchContext } from './context';
import { initialTrackingState, reposition, startTracking, update } from './tracker';

const calls = vi.hoisted(() => ({ wholeScript: 0 }));
vi.mock('./align', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./align')>();
  return {
    ...mod,
    alignPhrase: (...args: Parameters<typeof mod.alignPhrase>) => {
      const [ctx, , lo, hi] = args;
      if (lo <= 0 && hi >= ctx.keys.length - 1) calls.wholeScript++;
      return mod.alignPhrase(...args);
    },
  };
});

describe('tracker: cost', () => {
  it('keeps whole-script searches per final flat as an ad-lib goes on', () => {
    // A long talk, so each whole-script search is expensive.
    const ctx = createMatchContext(parseScript(Array(10).fill(TALK_SCRIPT).join('\n\n')));
    const adlib =
      'you know honestly when we started none of us really believed we would get here so it has been quite a journey for everyone'.split(
        ' ',
      );
    let s = reposition(startTracking(initialTrackingState()), 500);
    const perFinal: number[] = [];
    for (let i = 0; i < 12; i++) {
      const text = Array.from({ length: 10 }, (_, k) => adlib[(i * 10 + k) % adlib.length]).join(
        ' ',
      );
      calls.wholeScript = 0;
      s = update(ctx, s, {
        sessionId: 'cost',
        segmentId: `c${i}`,
        segmentOrder: i,
        kind: 'final',
        text,
        sequence: i,
      });
      perFinal.push(calls.wholeScript);
    }
    expect(s.lastDecision?.kind).toBe('none');
    // Bounded by one final's words, not by how long the ad-lib has run.
    expect(Math.max(...perFinal.slice(1)), perFinal.join(' ')).toBeLessThanOrEqual(perFinal[1]!);
  });
});
