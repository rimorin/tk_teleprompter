import { describe, expect, it } from 'vitest';
import { findOutlineBullets } from './outline';
import { parseScript } from './tokenizer';
import { LIST_SCRIPT, TALK_SCRIPT } from './fixtures/scripts';
import { FOUR_DAY_WEEK_OUTLINE, ONBOARDING_OUTLINE } from './fixtures/outlines';

function bulletTexts(source: string, maxWords = 10): string[] {
  const script = parseScript(source);
  return findOutlineBullets(script, maxWords).map((b) =>
    script.source.slice(
      script.tokens[b.firstTokenId]!.startOffset,
      script.tokens[b.lastTokenId]!.endOffset,
    ),
  );
}

describe('findOutlineBullets', () => {
  it('finds dash bullets, folding sub-bullets into their parent, without the marker', () => {
    const bullets = bulletTexts(ONBOARDING_OUTLINE);
    expect(bullets).toHaveLength(7);
    expect(bullets[0]).toBe('Why we are here: onboarding takes too long');
    expect(bullets[3]).toBe(
      'Pilot: automated importer with Acme Logistics\n  - mapping suggestions',
    );
    expect(bullets[6]).toBe('Questions');
  });

  it('finds numbered bullets', () => {
    expect(bulletTexts(FOUR_DAY_WEEK_OUTLINE)).toEqual([
      'Context: burnout survey results',
      'Trial design: 6 months, 3 teams',
      'Productivity held steady',
      'Customer response times',
      'Concerns: on-call coverage, hiring',
      'Recommendation: extend to engineering',
    ]);
  });

  it('finds no bullets in full scripts, including one written as list lines', () => {
    expect(bulletTexts(TALK_SCRIPT)).toEqual([]);
    expect(bulletTexts(LIST_SCRIPT)).toEqual([]);
  });

  it('keeps long list items (and their sub-items) as prose next to short bullets', () => {
    const source = [
      '- Short point one',
      '- This list item is a full sentence of the script and is far too long to be a bullet',
      '  - its sub item',
      '- Short point two',
    ].join('\n');
    expect(bulletTexts(source)).toEqual(['Short point one', 'Short point two']);
  });

  it('accepts *, • and 1) markers; blank lines keep a list, prose lines end it', () => {
    const source = 'Intro sentence here.\n\n* Alpha\n\n• Beta\n  continued as prose\n1) Gamma';
    expect(bulletTexts(source)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});
