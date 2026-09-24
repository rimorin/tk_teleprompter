import { describe, expect, it } from 'vitest';
import { parseScript } from '../tokenizer';
import { simulateReading, type SimOptions, type SimulatedEvent } from '../sim/simulator';
import { TALK_SCRIPT } from '../fixtures/scripts';
import type { TranscriptEvent } from '../types';
import { createMatchContext } from './context';
import {
  initialTrackingState,
  pauseTracking,
  reposition,
  startTracking,
  update,
  type TrackingState,
} from './tracker';

const script = parseScript(TALK_SCRIPT);
const ctx = createMatchContext(script);
const para = (n: number) => script.paragraphs[n]!;
/** Token id of the first token whose normalized text starts the phrase, searching from `from`. */
function find(phrase: string, from = 0): number {
  const words = phrase.toLowerCase().split(' ');
  for (let i = from; i < script.tokens.length; i++) {
    if (words.every((w, k) => script.tokens[i + k]?.normalized === w)) return i;
  }
  throw new Error(`phrase not found: ${phrase}`);
}
/** Token id of the last word of the phrase. */
const endOf = (phrase: string, from = 0) => find(phrase, from) + phrase.split(' ').length - 1;

type Trace = {
  state: TrackingState;
  history: Array<{ sim: SimulatedEvent; state: TrackingState }>;
};

function run(events: SimulatedEvent[], initial = startTracking(initialTrackingState())): Trace {
  let state = initial;
  const history: Trace['history'] = [];
  for (const sim of events) {
    state = update(ctx, state, sim.event);
    history.push({ sim, state });
  }
  return { state, history };
}

function simulate(options: SimOptions = {}) {
  return simulateReading(script, options);
}

function confirmedSeries(trace: Trace): number[] {
  return trace.history.map((h) => h.state.confirmedTokenId ?? -1);
}

function expectMonotonic(trace: Trace) {
  const series = confirmedSeries(trace);
  for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]!);
}

/** After each final, the confirmed cursor must be within `tolerance` tokens of the truth. */
function expectFollows(trace: Trace, tolerance: number, fromIndex = 0) {
  const finals = trace.history.slice(fromIndex).filter((h) => h.sim.event.kind === 'final');
  const errors = finals.map((h) =>
    Math.abs((h.state.confirmedTokenId ?? -1) - (h.sim.truthTokenId ?? -1)),
  );
  expect(Math.max(...errors)).toBeLessThanOrEqual(tolerance);
}

let seq = 1000;
function ev(
  kind: 'interim' | 'final',
  text: string,
  order: number,
  sessionId = 'manual',
): TranscriptEvent {
  return { sessionId, segmentId: `s${order}`, segmentOrder: order, kind, text, sequence: seq++ };
}

const lastToken = script.tokens.length - 1;

describe('tracker: reading the script', () => {
  it('follows an exact read to the end, monotonically, closely', () => {
    const trace = run(simulate());
    expectMonotonic(trace);
    expectFollows(trace, 2);
    expect(trace.state.confirmedTokenId).toBeGreaterThanOrEqual(lastToken - 1);
    expect(trace.state.status).toBe('tracking');
  });

  it('tolerates minor substitutions, fillers and interim revisions', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const trace = run(
        simulate({ seed, substitutionRate: 0.08, fillerRate: 0.08, interimRevisionRate: 0.3 }),
      );
      expectMonotonic(trace);
      expectFollows(trace, 6);
      expect(trace.state.confirmedTokenId).toBeGreaterThanOrEqual(lastToken - 3);
    }
  });

  it('interim hypotheses move only the tentative cursor', () => {
    const trace = run(simulate({ interimRevisionRate: 0.5, seed: 7 }));
    for (let i = 1; i < trace.history.length; i++) {
      const { sim, state } = trace.history[i]!;
      const prev = trace.history[i - 1]!.state;
      if (sim.event.kind === 'interim') expect(state.confirmedTokenId).toBe(prev.confirmedTokenId);
      if (state.tentativeTokenId !== null) {
        expect(state.tentativeTokenId).toBeGreaterThan(state.confirmedTokenId ?? -1);
      }
    }
    // The tentative cursor runs ahead of confirmed during at least some interims.
    expect(trace.history.some((h) => h.state.tentativeTokenId !== null)).toBe(true);
  });

  it('matches spoken number forms to digits in the script', () => {
    const at = find('in testing completion');
    const events = simulate({
      startTokenId: at,
      actions: [{ type: 'stop', atTokenId: find('we also removed') }],
    });
    expect(events.some((e) => e.event.text.includes('twenty twenty five'))).toBe(true);
    const trace = run(events, reposition(startTracking(initialTrackingState()), at));
    expect(trace.state.confirmedTokenId).toBeGreaterThanOrEqual(find('we also removed') - 2);
    expectFollows(trace, 2);
  });
});

describe('tracker: interim and final handling', () => {
  it('replaces a corrected interim instead of appending it', () => {
    let s = startTracking(initialTrackingState());
    s = update(ctx, s, ev('interim', 'good morning and thank', 0));
    const t1 = s.tentativeTokenId;
    expect(t1).toBe(find('thank'));
    s = update(ctx, s, ev('interim', 'good morning and bananas you', 0));
    s = update(ctx, s, ev('interim', 'good morning and thank you very', 0));
    expect(s.tentativeTokenId).toBe(find('very'));
    expect(s.confirmedTokenId).toBeNull();
    expect(s.transcript.interim?.words).toEqual(['good', 'morning', 'and', 'thank', 'you', 'very']);
    s = update(ctx, s, ev('final', 'good morning and thank you very much', 0));
    expect(s.confirmedTokenId).toBe(find('much'));
    expect(s.transcript.finalWords).toHaveLength(7);
  });

  it('keeps the tentative cursor when an interim revision does not match', () => {
    let s = startTracking(initialTrackingState());
    s = update(ctx, s, ev('interim', 'good morning and thank', 0));
    expect(s.tentativeTokenId).toBe(find('thank'));
    s = update(ctx, s, ev('interim', 'bananas later thing okay maybe', 0));
    expect(s.tentativeTokenId).toBe(find('thank'));
    // A final commits and clears it.
    s = update(ctx, s, ev('final', 'good morning and thank you very much', 0));
    expect(s.confirmedTokenId).toBe(find('much'));
    expect(s.tentativeTokenId).toBeNull();
  });

  it('never moves the reading focus backward on an interim (Deepgram-like cadence)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const trace = run(
        simulate({
          seed,
          substitutionRate: 0.1,
          fillerRate: 0.08,
          interimRevisionRate: 0.3,
          interimEveryWords: 3,
          segmentWords: [8, 20],
          finalLatencyMs: 600,
        }),
      );
      const focus = (s: TrackingState) => s.tentativeTokenId ?? s.confirmedTokenId ?? -1;
      for (let i = 1; i < trace.history.length; i++) {
        const { sim, state } = trace.history[i]!;
        if (sim.event.kind !== 'interim') continue;
        expect(focus(state)).toBeGreaterThanOrEqual(focus(trace.history[i - 1]!.state));
        expect((state.tentativeTokenId ?? -1) - (sim.truthTokenId ?? -1)).toBeLessThanOrEqual(0);
      }
    }
  });

  it('ignores stale (out-of-order) interim revisions', () => {
    let s = startTracking(initialTrackingState());
    s = update(ctx, s, { ...ev('interim', 'good morning and thank you', 0), sequence: 50 });
    s = update(ctx, s, { ...ev('interim', 'good morning', 0), sequence: 49 });
    expect(s.transcript.interim?.words).toHaveLength(5);
  });

  it('deduplicates repeated finals and orders late ones', () => {
    let s = startTracking(initialTrackingState());
    const f1 = ev('final', 'good morning and thank you very much', 0);
    const f2 = ev('final', 'for coming today i want to share', 3000);
    s = update(ctx, s, f1);
    s = update(ctx, s, f2);
    const after = s;
    s = update(ctx, s, f1);
    s = update(ctx, s, f2);
    expect(s.transcript.finalWords).toEqual(after.transcript.finalWords);
    expect(s.confirmedTokenId).toBe(after.confirmedTokenId);
    expect(s.confirmedTokenId).toBe(endOf('to share'));

    // A final that arrives late is inserted by segment order, not appended.
    let r = startTracking(initialTrackingState());
    r = update(ctx, r, ev('final', 'for coming today i want to share', 3000, 'late'));
    r = update(ctx, r, ev('final', 'good morning and thank you very much', 0, 'late'));
    expect(r.transcript.finalWords.slice(0, 3)).toEqual(['good', 'morning', 'and']);
  });

  it('starts a fresh transcript when the provider session changes', () => {
    let s = startTracking(initialTrackingState());
    s = update(ctx, s, ev('final', 'good morning and thank you very much', 0, 'a'));
    s = update(ctx, s, ev('final', 'for coming today i want to share', 0, 'b'));
    expect(s.transcript.finalWords[0]).toBe('for');
    expect(s.confirmedTokenId).toBe(endOf('to share'));
  });
});

describe('tracker: pauses, silence and unrelated speech', () => {
  it('does not advance on silence (empty finals)', () => {
    let s = run(simulate({ actions: [{ type: 'stop', atTokenId: find('today i want') }] })).state;
    const before = s.confirmedTokenId;
    for (let i = 0; i < 5; i++) s = update(ctx, s, ev('final', '', 90_000 + i));
    expect(s.confirmedTokenId).toBe(before);
    expect(s.status).toBe('tracking');
  });

  it('waits through a long pause and continues', () => {
    const at = find('at the end of the day onboarding');
    const trace = run(simulate({ actions: [{ type: 'pause', atTokenId: at, ms: 20_000 }] }));
    expectMonotonic(trace);
    expectFollows(trace, 2);
  });

  it('does not advance on unrelated speech and reports uncertainty', () => {
    let s = run(simulate({ actions: [{ type: 'stop', atTokenId: find('today i want') }] })).state;
    const before = s.confirmedTokenId;
    s = update(ctx, s, ev('final', 'sorry the projector seems to be flickering again', 100_000));
    s = update(ctx, s, ev('final', 'can someone in the back check the cable please', 103_000));
    s = update(ctx, s, ev('final', 'great it works now lovely', 106_000));
    expect(s.confirmedTokenId).toBe(before);
    expect(s.status).toBe('uncertain');
  });

  it('holds during an ad-lib and reacquires when reading resumes', () => {
    const at = find('last spring');
    const trace = run(
      simulate({
        actions: [
          {
            type: 'adlib',
            atTokenId: at,
            text: 'let me tell you a quick story about my dog who loves long walks by the river',
          },
        ],
      }),
    );
    expectMonotonic(trace);
    const adlibStart = trace.history.findIndex((h) => h.sim.event.text.includes('dog'));
    const heldAt = trace.history[adlibStart]!.state.confirmedTokenId!;
    expect(heldAt).toBeLessThan(at);
    expect(trace.state.confirmedTokenId).toBeGreaterThanOrEqual(lastToken - 1);
    // Within a few segments after the ad-lib, tracking is close again.
    const resumed = trace.history.findIndex(
      (h, i) =>
        i > adlibStart && h.sim.event.kind === 'final' && (h.sim.truthTokenId ?? 0) > at + 20,
    );
    expectFollows(trace, 3, resumed);
  });

  it('confirms script words that precede an ad-lib within the same segment', () => {
    let s = startTracking(initialTrackingState());
    s = update(ctx, s, ev('final', 'good morning and thank you very much for coming', 0));
    s = update(
      ctx,
      s,
      ev('final', 'today i want to share what by the way my cat says hello to everyone', 3000),
    );
    expect(s.confirmedTokenId).toBe(endOf('to share what'));
  });

  it('pausing tracking freezes the cursor; resuming continues from there', () => {
    const stopAt = find('at the end of the day onboarding');
    let s = run(simulate({ actions: [{ type: 'stop', atTokenId: stopAt }] })).state;
    const before = s.confirmedTokenId;
    s = pauseTracking(s);
    s = update(ctx, s, ev('final', 'at the end of the day onboarding is a promise', 500_000));
    expect(s.confirmedTokenId).toBe(before);
    expect(s.status).toBe('paused');
    s = startTracking(s);
    s = update(ctx, s, ev('final', 'we tell people that the product will make', 510_000));
    expect(s.confirmedTokenId).toBe(endOf('will make'));
  });
});

describe('tracker: skips, repeats and jumps', () => {
  it('follows a skipped sentence within a paragraph', () => {
    const skipFrom = find('almost every one');
    const skipTo = find('and that is why we started');
    const trace = run(
      simulate({ actions: [{ type: 'skip', atTokenId: skipFrom, toTokenId: skipTo }] }),
    );
    expectMonotonic(trace);
    const after = trace.history.findIndex(
      (h) => (h.sim.truthTokenId ?? 0) >= skipTo + 8 && h.sim.event.kind === 'final',
    );
    expectFollows(trace, 3, after);
  });

  it('makes a controlled forward jump when a whole paragraph is skipped', () => {
    const skipFrom = para(2).firstTokenId;
    const skipTo = para(4).firstTokenId;
    const trace = run(
      simulate({ seed: 3, actions: [{ type: 'skip', atTokenId: skipFrom, toTokenId: skipTo }] }),
    );
    expectMonotonic(trace);
    const jumps = trace.history.filter((h) => h.state.lastDecision?.kind === 'far');
    expect(jumps.length).toBeGreaterThanOrEqual(1);
    // The jump lands in the paragraph actually being read, never before it and not far beyond.
    const landed = jumps[0]!.state.confirmedTokenId!;
    expect(script.tokens[landed]!.paragraphId).toBe(4);
    expect(landed).toBeLessThanOrEqual(jumps[0]!.sim.truthTokenId! + 3);
    // It needed at least a full distinctive phrase read after the skip.
    expect(jumps[0]!.sim.truthTokenId! - skipTo + 1).toBeGreaterThanOrEqual(ctx.config.farMinWords);
    expect(trace.state.confirmedTokenId).toBeGreaterThanOrEqual(lastToken - 1);
  });

  it('reacquires after skipping from any paragraph to any later one (5% recognition errors)', () => {
    const P = script.paragraphs;
    for (let a = 0; a < P.length; a++) {
      for (let b = a + 2; b < P.length; b++) {
        for (const seed of [1, 2, 3]) {
          const trace = run(
            simulate({
              seed,
              substitutionRate: 0.05,
              actions: [
                { type: 'skip', atTokenId: P[a]!.firstTokenId, toTokenId: P[b]!.firstTokenId },
              ],
            }),
          );
          const label = `${a}->${b} seed ${seed}`;
          expectMonotonic(trace);
          for (const h of trace.history) {
            // Never ahead of the speaker.
            expect(h.state.confirmedTokenId ?? -1, label).toBeLessThanOrEqual(
              (h.sim.truthTokenId ?? -1) + 1,
            );
          }
          expect(trace.state.confirmedTokenId, label).toBeGreaterThanOrEqual(lastToken - 3);
        }
      }
    }
  });

  it('a far jump waits until enough words agree, however speech is split into finals', () => {
    const start = run(simulate({ actions: [{ type: 'stop', atTokenId: para(1).firstTokenId }] }));
    const read =
      'there are risks templates can feel generic and some teams want a blank canvas so every template will be optional and we will measure';
    const words = read.split(' ');
    for (const size of [5, 7, 15]) {
      let s = start.state;
      const decisions: string[] = [];
      for (let i = 0; i < words.length && s.lastDecision?.kind !== 'far'; i += size) {
        s = update(ctx, s, ev('final', words.slice(i, i + size).join(' '), 300_000 + i * 400));
        decisions.push(s.lastDecision!.kind);
      }
      const label = `finals of ${size}`;
      // Never on the first final, even a long one; a jump once about 14 words agree.
      expect(decisions[0], label).toBe('far-pending');
      expect(decisions.at(-1), label).toBe('far');
      expect(script.tokens[s.confirmedTokenId!]!.paragraphId, label).toBe(6);
    }
  });

  it('does not jump when the speaker quotes a later part of the talk, then carries on', () => {
    const at = find('almost every one');
    const quote =
      'our next experiment is guided templates instead of an empty workspace new customers pick a template';
    let s = run(simulate({ actions: [{ type: 'stop', atTokenId: at }] })).state;
    const before = s.confirmedTokenId!;
    s = update(ctx, s, ev('final', `later i will show you ${quote}`, 400_000));
    expect(s.jumpSuggestion).not.toBeNull(); // offered, not taken
    expect(s.confirmedTokenId).toBe(before);
    s = update(ctx, s, ev('final', 'almost every one of them described the same moment', 404_000));
    expect(s.confirmedTokenId).toBe(endOf('the same moment'));
    expect(s.jumpSuggestion).toBeNull(); // back on track: the offer goes away
  });

  it('suggests the likely place from interims as soon as the speaker seems lost', () => {
    let s = run(simulate({ actions: [{ type: 'stop', atTokenId: para(1).firstTokenId }] })).state;
    const confirmed = s.confirmedTokenId;
    s = update(ctx, s, ev('interim', 'there are risks templates can feel generic', 300_000));
    expect(s.jumpSuggestion).toBe(endOf('can feel generic'));
    // A suggestion moves nothing.
    expect(s.confirmedTokenId).toBe(confirmed);
    expect(s.tentativeTokenId).toBeNull();
    // Tapping it is an ordinary manual reposition, which clears it.
    s = reposition(s, s.jumpSuggestion! + 1);
    expect(s.confirmedTokenId).toBe(endOf('can feel generic'));
    expect(s.jumpSuggestion).toBeNull();
  });

  it('never jumps backward automatically when the speaker re-reads', () => {
    const at = find('we also removed');
    const trace = run(
      simulate({
        actions: [{ type: 'repeat', atTokenId: at, fromTokenId: find('the new importer') }],
      }),
    );
    expectMonotonic(trace);
    expect(trace.history.some((h) => h.state.lastDecision?.kind === 'hold')).toBe(true);
    expect(trace.state.confirmedTokenId).toBeGreaterThanOrEqual(lastToken - 1);
  });

  it('does not jump on a common phrase that occurs elsewhere', () => {
    let s = run(simulate({ actions: [{ type: 'stop', atTokenId: para(1).firstTokenId }] })).state;
    const before = s.confirmedTokenId!;
    for (const [i, text] of [
      'thank you very much',
      'and that is why',
      'at the end of the day',
      'thank you very much and that is why',
    ].entries()) {
      s = update(ctx, s, ev('final', text, 200_000 + i * 1000));
    }
    // Only local progress into the adjacent "At the end of the day" is acceptable.
    expect(s.confirmedTokenId!).toBeLessThanOrEqual(para(1).firstTokenId + 6);
    expect(before).toBeLessThan(para(1).firstTokenId);
  });

  it('does not jump far on weak evidence from a single distinctive-sounding segment', () => {
    let s = run(simulate({ actions: [{ type: 'stop', atTokenId: para(1).firstTokenId }] })).state;
    s = update(ctx, s, ev('final', 'our next experiment is guided templates', 300_000));
    expect(script.tokens[s.confirmedTokenId!]!.paragraphId).toBeLessThanOrEqual(1);
    expect(s.pendingJump).not.toBeNull();
  });

  it('survives a paraphrase without drifting and reacquires afterwards', () => {
    const from = find('the new importer previews');
    const to = find('in testing completion');
    const trace = run(
      simulate({
        seed: 11,
        actions: [
          {
            type: 'adlib',
            atTokenId: from,
            text: 'our fresh importer shows you all the columns first and describes each problem simply',
          },
          { type: 'skip', atTokenId: from, toTokenId: to },
        ],
      }),
    );
    expectMonotonic(trace);
    const paraphraseEnd = trace.history.findIndex(
      (h) => (h.sim.truthTokenId ?? 0) >= to && h.sim.event.kind === 'final',
    );
    // During the paraphrase the cursor never runs past the paraphrased passage.
    for (const h of trace.history.slice(0, paraphraseEnd)) {
      expect(h.state.confirmedTokenId ?? -1).toBeLessThan(to + 2);
    }
    expect(trace.state.confirmedTokenId).toBeGreaterThanOrEqual(lastToken - 1);
  });
});

describe('tracker: after a lost connection', () => {
  it('picks the speaker up quickly on a new session, from interims, without running ahead', () => {
    const opts: SimOptions = {
      substitutionRate: 0.08,
      fillerRate: 0.05,
      interimRevisionRate: 0.3,
      interimEveryWords: 3,
      segmentWords: [8, 20],
      finalLatencyMs: 600,
    };
    // Up to ~45 words: an outage of about 15 s, plus detecting it and reconnecting.
    for (const gap of [8, 15, 25, 45]) {
      for (const seed of [1, 2, 3]) {
        const start = para(1).firstTokenId;
        const cut = start + 20;
        const resume = cut + gap; // words spoken while offline are never heard
        const before = simulate({
          ...opts,
          seed,
          sessionId: 'A',
          startTokenId: start,
          actions: [{ type: 'stop', atTokenId: cut }],
        });
        const after = simulate({
          ...opts,
          seed,
          sessionId: 'B',
          startTokenId: resume,
          actions: [{ type: 'stop', atTokenId: resume + 25 }],
        });
        let s = run(before, reposition(startTracking(initialTrackingState()), start)).state;
        let backAfter: number | null = null;
        for (const sim of after) {
          s = update(ctx, s, sim.event);
          const truth = sim.truthTokenId ?? resume;
          const focus = s.tentativeTokenId ?? s.confirmedTokenId ?? -1;
          const label = `gap ${gap} seed ${seed}`;
          expect(focus, label).toBeLessThanOrEqual(truth + 1); // never ahead of the speaker
          expect(s.confirmedTokenId ?? -1, label).toBeLessThanOrEqual(truth + 1);
          if (backAfter === null && focus >= resume) backAfter = truth - resume + 1;
        }
        expect(backAfter, `gap ${gap} seed ${seed}`).not.toBeNull();
        expect(backAfter!, `gap ${gap} seed ${seed}`).toBeLessThanOrEqual(gap > 30 ? 15 : 9);
      }
    }
  });

  it('does not let the first session skip ahead on interims', () => {
    let s = startTracking(initialTrackingState());
    // Words from further into the first paragraph, heard as an interim on the very first session.
    s = update(ctx, s, ev('interim', 'rebuilding the onboarding flow for new customers', 0));
    expect(s.resyncing).toBe(false);
    expect(s.tentativeTokenId).toBeNull();
  });
});

describe('tracker: manual reposition', () => {
  it('repositions immediately and ignores speech heard before the tap', () => {
    // Read the first paragraph, then tap back to the start and read it again.
    const events = simulate({ actions: [{ type: 'stop', atTokenId: para(1).firstTokenId }] });
    let s = run(events).state;
    expect(s.confirmedTokenId).toBeGreaterThan(10);
    s = reposition(s, 0);
    expect(s.confirmedTokenId).toBeNull();
    s = update(ctx, s, ev('final', 'good morning and thank you', 400_000));
    expect(s.confirmedTokenId).toBe(endOf('thank you'));
  });

  it('repositions forward and tracks from there', () => {
    const target = para(5).firstTokenId;
    let s = reposition(startTracking(initialTrackingState()), target);
    const trace = run(simulate({ startTokenId: target, sessionId: 'after-tap' }), s);
    s = trace.state;
    expectFollows(trace, 2);
    expect(s.confirmedTokenId).toBeGreaterThanOrEqual(lastToken - 1);
  });

  it('ignores the unfinalized interim words spoken before the tap', () => {
    let s = startTracking(initialTrackingState());
    s = update(ctx, s, ev('interim', 'good morning and thank you very', 0));
    s = reposition(s, para(1).firstTokenId);
    // The segment that was in progress finalizes, including words spoken before the tap.
    s = update(
      ctx,
      s,
      ev('final', 'good morning and thank you very much at the end of the day', 0),
    );
    expect(s.confirmedTokenId).toBe(endOf('at the end of the day'));
  });
});
