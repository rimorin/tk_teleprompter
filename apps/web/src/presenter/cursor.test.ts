import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCHER_CONFIG, findOutlineBullets, parseScript } from '@teleprompter/shared';
import { currentSection, focusTokenId, sections, sectionStepTarget, type Cursor } from './cursor';

const script = parseScript('one two three\n\nfour five\n\nsix');
const paragraphs = sections(script, []);
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

  it('steps forward and back by paragraph when there is no outline', () => {
    expect(paragraphs).toHaveLength(3);
    expect(sectionStepTarget(script, paragraphs, at(null), 1)).toBe(3);
    expect(currentSection(script, paragraphs, at(2))).toBe(1);
    expect(sectionStepTarget(script, paragraphs, at(2), -1)).toBe(0);
    expect(sectionStepTarget(script, paragraphs, at(3), -1)).toBe(3);
    expect(sectionStepTarget(script, paragraphs, at(4), 1)).toBeNull();
    expect(sectionStepTarget(script, paragraphs, at(null), -1)).toBeNull();
  });

  it('steps through outline bullets one point at a time, and on into prose', () => {
    const mixed = parseScript('Intro words here.\n- Alpha point\n- Beta point\n\nClosing words.');
    const secs = sections(
      mixed,
      findOutlineBullets(mixed, DEFAULT_MATCHER_CONFIG.outline.maxBulletWords),
    );
    // "Intro words here." | "- Alpha point" | "- Beta point" | "Closing words."
    expect(secs.map((s) => s.bullet)).toEqual([false, true, true, false]);
    const [intro, alpha, beta, closing] = secs;
    expect(mixed.tokens[alpha!.firstTokenId]!.displayText).toBe('-');
    expect(sectionStepTarget(mixed, secs, at(null), 1)).toBe(alpha!.firstTokenId);
    // On a bullet, the cursor sits just before its marker.
    expect(currentSection(mixed, secs, at(alpha!.firstTokenId - 1))).toBe(1);
    expect(sectionStepTarget(mixed, secs, at(alpha!.firstTokenId - 1), 1)).toBe(beta!.firstTokenId);
    expect(sectionStepTarget(mixed, secs, at(beta!.firstTokenId - 1), 1)).toBe(
      closing!.firstTokenId,
    );
    expect(sectionStepTarget(mixed, secs, at(beta!.firstTokenId - 1), -1)).toBe(
      alpha!.firstTokenId,
    );
    expect(intro!.firstTokenId).toBe(0);
  });
});
