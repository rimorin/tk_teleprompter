import { describe, expect, it } from 'vitest';
import { createAssemblyAiNormalizer } from './normalizeAssemblyAi';

/** A Turn message; `final` words are marked word_is_final, the rest are tentative. */
function turn(order: number, final: string, tentative = '', endOfTurn = false) {
  const words = [
    ...final
      .split(' ')
      .filter(Boolean)
      .map((text) => ({ text, word_is_final: true })),
    ...tentative
      .split(' ')
      .filter(Boolean)
      .map((text) => ({ text, word_is_final: false })),
  ].map((w, i) => ({ ...w, start: i * 300, end: i * 300 + 250, confidence: 0.9 }));
  return { type: 'Turn', turn_order: order, end_of_turn: endOfTurn, words };
}

const brief = (ts: ReturnType<ReturnType<typeof createAssemblyAiNormalizer>>) =>
  ts.map((t) => `${t.kind}:${t.segmentOrder}:${t.text}`);

describe('createAssemblyAiNormalizer', () => {
  it('sends each newly finalized run of words once, and the rest as the interim', () => {
    const n = createAssemblyAiNormalizer();
    expect(brief(n(turn(0, '', 'good')))).toEqual(['interim:0:good']);
    expect(brief(n(turn(0, 'good', 'morning every')))).toEqual([
      'final:0:good',
      'interim:1:morning every',
    ]);
    // A revised tentative word just replaces the interim.
    expect(brief(n(turn(0, 'good', 'morning everyone')))).toEqual(['interim:1:morning everyone']);
    expect(brief(n(turn(0, 'good morning everyone', '')))).toEqual([
      'final:1:morning everyone',
      'interim:3:',
    ]);
    // End of turn: nothing new to finalize.
    expect(brief(n(turn(0, 'good morning everyone', '', true)))).toEqual(['interim:3:']);
  });

  it('orders later turns after earlier ones and finalizes what is left at the end of a turn', () => {
    const n = createAssemblyAiNormalizer();
    n(turn(0, 'good', 'morning'));
    // Some words may still be tentative on the end-of-turn message: they are final now.
    expect(brief(n(turn(0, 'good', 'morning', true)))).toEqual(['final:1:morning', 'interim:2:']);
    const next = n(turn(1, 'today', 'i'));
    expect(brief(next)).toEqual(['final:1000000:today', 'interim:1000001:i']);
    expect(next[0]!.segmentId).toBe('aai-1-0');
    expect(next[0]!.words).toEqual([{ text: 'today', startMs: 0, endMs: 250, confidence: 0.9 }]);
  });

  it('never takes back a word it already sent as final', () => {
    const n = createAssemblyAiNormalizer();
    n(turn(0, 'good morning', 'every'));
    // If a message ever marked an earlier word tentative again, it stays final here.
    expect(brief(n(turn(0, 'good', 'morning everyone')))).toEqual(['interim:2:everyone']);
  });

  it('ignores other messages', () => {
    const n = createAssemblyAiNormalizer();
    expect(n({ type: 'Begin', id: 'x', expires_at: 1 })).toEqual([]);
    expect(n({ type: 'Termination' })).toEqual([]);
    expect(n(null)).toEqual([]);
  });
});
