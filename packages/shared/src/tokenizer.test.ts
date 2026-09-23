import { describe, expect, it } from 'vitest';
import { parseScript } from './tokenizer';

function expectOffsetsRoundTrip(text: string) {
  const script = parseScript(text);
  for (const t of script.tokens) {
    expect(script.source.slice(t.startOffset, t.endOffset)).toBe(t.displayText);
  }
  return script;
}

describe('parseScript', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(parseScript('').tokens).toEqual([]);
    expect(parseScript('  \n\n \t ').paragraphs).toEqual([]);
  });

  it('splits paragraphs on blank lines and keeps single newlines inside a paragraph', () => {
    const script = expectOffsetsRoundTrip(
      'First line\nstill first.\n\n  \nSecond para.\n\n\nThird',
    );
    expect(script.paragraphs).toHaveLength(3);
    expect(script.tokens.map((t) => t.paragraphId)).toEqual([0, 0, 0, 0, 1, 1, 2]);
    const [p0, p1, p2] = script.paragraphs;
    expect(script.source.slice(p0!.startOffset, p0!.endOffset)).toBe('First line\nstill first.');
    expect(p1!.firstTokenId).toBe(4);
    expect(p1!.lastTokenId).toBe(5);
    expect(p2!.firstTokenId).toBe(6);
  });

  it('normalizes CRLF and BOM without altering other characters', () => {
    const script = expectOffsetsRoundTrip('﻿Hello,\r\nworld!\r\n\r\nBye');
    expect(script.source).toBe('Hello,\nworld!\n\nBye');
    expect(script.paragraphs).toHaveLength(2);
  });

  it('gives duplicate words distinct stable ids and positions', () => {
    const script = expectOffsetsRoundTrip('the cat and the hat and the bat');
    const thes = script.tokens.filter((t) => t.normalized === 'the');
    expect(thes.map((t) => t.id)).toEqual([0, 3, 6]);
    expect(new Set(thes.map((t) => t.startOffset)).size).toBe(3);
    expect(script.tokens.map((t) => t.id)).toEqual(script.tokens.map((_, i) => i));
  });

  it('keeps punctuation attached to display tokens and strips it from the normalized form', () => {
    const script = expectOffsetsRoundTrip('"Hello," she said. (Really?) Yes!');
    expect(script.tokens.map((t) => t.displayText)).toEqual([
      '"Hello,"',
      'she',
      'said.',
      '(Really?)',
      'Yes!',
    ]);
    expect(script.tokens.map((t) => t.normalized)).toEqual([
      'hello',
      'she',
      'said',
      'really',
      'yes',
    ]);
  });

  it('handles contractions and curly apostrophes', () => {
    const script = expectOffsetsRoundTrip("Don’t stop — we’re here. It's fine.");
    expect(script.tokens.map((t) => t.normalized)).toEqual([
      "don't",
      'stop',
      '',
      "we're",
      'here',
      "it's",
      'fine',
    ]);
  });

  it('splits hyphenated words into separate tokens with contiguous offsets', () => {
    const script = expectOffsetsRoundTrip('A well-known state-of-the-art idea—really.');
    expect(script.tokens.map((t) => t.displayText)).toEqual([
      'A',
      'well-',
      'known',
      'state-',
      'of-',
      'the-',
      'art',
      'idea—',
      'really.',
    ]);
    expect(script.tokens.map((t) => t.normalized)).toEqual([
      'a',
      'well',
      'known',
      'state',
      'of',
      'the',
      'art',
      'idea',
      'really',
    ]);
  });

  it('preserves Unicode text and offsets', () => {
    const script = expectOffsetsRoundTrip('Café naïve 🎉 emoji, Ünïcödé words.\n\nnoël');
    expect(script.tokens.map((t) => t.normalized)).toEqual([
      'café',
      'naïve',
      '',
      'emoji',
      'ünïcödé',
      'words',
      'noël',
    ]);
  });

  it('adds spoken forms for numbers and symbols', () => {
    const script = parseScript(
      'In 2026 we sold 1,500 units, 20% more, for $5 each & the 3rd time.',
    );
    const forms = Object.fromEntries(
      script.tokens.filter((t) => t.spokenForms).map((t) => [t.displayText, t.spokenForms]),
    );
    expect(forms).toEqual({
      '2026': ['twenty twenty six', 'two thousand twenty six'],
      '1,500': ['one thousand five hundred'],
      '20%': ['twenty percent'],
      $5: ['five dollars'],
      '3rd': ['third'],
    });
    expect(script.tokens.find((t) => t.displayText === '&')?.normalized).toBe('and');
  });

  it('collapses dotted abbreviations', () => {
    expect(parseScript('The U.S. economy').tokens.map((t) => t.normalized)).toEqual([
      'the',
      'us',
      'economy',
    ]);
  });
});
