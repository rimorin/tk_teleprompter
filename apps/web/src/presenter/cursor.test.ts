import { describe, expect, it } from 'vitest';
import { parseScript } from '@teleprompter/shared';
import { currentParagraphId, focusTokenId, paragraphStepTarget, type Cursor } from './cursor';

const script = parseScript('one two three\n\nfour five\n\nsix');
const at = (confirmedTokenId: number | null, tentativeTokenId: number | null = null): Cursor => ({
  confirmedTokenId,
  tentativeTokenId,
});

describe('cursor helpers', () => {
  it('focuses the next token to read', () => {
    expect(focusTokenId(script, at(null))).toBe(0);
    expect(focusTokenId(script, at(1))).toBe(2);
    expect(focusTokenId(script, at(1, 3))).toBe(4);
    expect(focusTokenId(script, at(5))).toBe(5);
    expect(focusTokenId(parseScript(''), at(null))).toBeNull();
  });

  it('steps forward and back by paragraph', () => {
    expect(paragraphStepTarget(script, at(null), 1)).toBe(3);
    expect(currentParagraphId(script, at(2))).toBe(1);
    expect(paragraphStepTarget(script, at(2), -1)).toBe(0);
    expect(paragraphStepTarget(script, at(3), -1)).toBe(3);
    expect(paragraphStepTarget(script, at(4), 1)).toBeNull();
    expect(paragraphStepTarget(script, at(null), -1)).toBeNull();
  });
});
