import { integerToWords, numericSpokenForms } from './numberWords';

const APOSTROPHES = /[\u2018\u2019\u02BC\u0060\u00B4]/g;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const DOTTED_ABBREVIATION = /^(?:\p{L}\.)+\p{L}$/u;
/** Hyphens, dashes and slashes that separate words inside a whitespace-delimited chunk. */
export const WORD_JOINERS = '\\-\u2010\u2011\u2012\u2013\u2014\u2015/';

/**
 * Normalize one word for matching: NFC, unified apostrophes, lowercase, edge punctuation removed,
 * dotted abbreviations collapsed ("U.S." -> "us"). Conservative by design.
 */
export function normalizeWord(raw: string): string {
  let s = raw.normalize('NFC').replace(APOSTROPHES, "'").toLocaleLowerCase('en');
  if (s === '&') return 'and';
  s = s.replace(EDGE_PUNCTUATION, '');
  if (DOTTED_ABBREVIATION.test(s)) s = s.replace(/\./g, '');
  return s;
}

/** Spoken renderings of a script chunk that differ from its normalized form (numbers, symbols). */
export function spokenFormsFor(raw: string): string[] {
  // Keep $, %, and inner . , so numeric formats survive; strip other edge punctuation.
  const trimmed = raw
    .normalize('NFC')
    .replace(/^[^\p{L}\p{N}$]+/u, '')
    .replace(/[^\p{L}\p{N}%]+$/u, '');
  return numericSpokenForms(trimmed);
}

/**
 * Split recognized speech into normalized words. Hyphenated words become separate words and
 * digit tokens are expanded to number words, mirroring how script tokens are compared.
 */
export function normalizeSpokenText(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/\s+/)) {
    for (const part of chunk.split(new RegExp(`[${WORD_JOINERS}]+`))) {
      if (!part) continue;
      const forms = spokenFormsFor(part);
      if (forms.length) {
        out.push(...forms[0]!.split(' '));
        continue;
      }
      const word = normalizeWord(part);
      if (!word) continue;
      if (/^\d+$/.test(word)) {
        const words = integerToWords(Number(word));
        if (words) {
          out.push(...words.split(' '));
          continue;
        }
      }
      out.push(word);
    }
  }
  return out;
}
