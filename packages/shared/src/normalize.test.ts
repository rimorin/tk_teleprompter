import { describe, expect, it } from 'vitest';
import { normalizeSpokenText, normalizeWord } from './normalize';
import { integerToWords, numericSpokenForms, yearToWords } from './numberWords';

describe('normalizeWord', () => {
  it('lowercases, unifies apostrophes and strips edge punctuation', () => {
    expect(normalizeWord('“Don’t,”')).toBe("don't");
    expect(normalizeWord('...Hello!?')).toBe('hello');
    expect(normalizeWord('—')).toBe('');
  });
});

describe('normalizeSpokenText', () => {
  it('splits and normalizes recognizer output', () => {
    expect(normalizeSpokenText('  Hello, World.  well-known ')).toEqual([
      'hello',
      'world',
      'well',
      'known',
    ]);
  });

  it('expands digits to words', () => {
    expect(normalizeSpokenText('about 25 people in 1999')).toEqual([
      'about',
      'twenty',
      'five',
      'people',
      'in',
      'nineteen',
      'ninety',
      'nine',
    ]);
  });

  it('returns [] for empty text', () => {
    expect(normalizeSpokenText('   ')).toEqual([]);
  });
});

describe('number words', () => {
  it('converts integers', () => {
    expect(integerToWords(0)).toBe('zero');
    expect(integerToWords(42)).toBe('forty two');
    expect(integerToWords(105)).toBe('one hundred five');
    expect(integerToWords(1_000_001)).toBe('one million one');
    expect(integerToWords(-1)).toBeNull();
  });

  it('converts years', () => {
    expect(yearToWords(1999)).toBe('nineteen ninety nine');
    expect(yearToWords(1905)).toBe('nineteen oh five');
    expect(yearToWords(1900)).toBe('nineteen hundred');
    expect(yearToWords(2005)).toBe('two thousand five');
    expect(yearToWords(3000)).toBeNull();
  });

  it('handles ordinals, decades, decimals and non-numbers', () => {
    expect(numericSpokenForms('21st')).toEqual(['twenty first']);
    expect(numericSpokenForms('12th')).toEqual(['twelfth']);
    expect(numericSpokenForms('1990s')).toEqual(['nineteen nineties']);
    expect(numericSpokenForms('2.5')).toEqual(['two point five']);
    expect(numericSpokenForms('abc')).toEqual([]);
    expect(numericSpokenForms('1.2.3')).toEqual([]);
  });
});
