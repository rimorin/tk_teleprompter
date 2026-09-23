import { normalizeWord, spokenFormsFor, WORD_JOINERS } from './normalize';
import type { Paragraph, ParsedScript, ScriptToken } from './types';

/** Splits "well-known" into "well-" and "known"; keeps standalone dashes as their own chunk. */
const SUBCHUNK = new RegExp(`[^${WORD_JOINERS}]+[${WORD_JOINERS}]*|[${WORD_JOINERS}]+`, 'g');

function normalizeLineEndings(input: string): string {
  return input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/**
 * Parse a script into paragraphs (separated by blank lines) and display tokens. Every token's
 * offsets satisfy `source.slice(startOffset, endOffset) === displayText`.
 */
export function parseScript(input: string): ParsedScript {
  const source = normalizeLineEndings(input);
  const paragraphs: Paragraph[] = [];
  const tokens: ScriptToken[] = [];

  for (const [start, end] of paragraphSpans(source)) {
    const paragraphId = paragraphs.length;
    const firstTokenId = tokens.length;
    const text = source.slice(start, end);
    for (const chunk of text.matchAll(/\S+/g)) {
      for (const sub of chunk[0].matchAll(SUBCHUNK)) {
        const displayText = sub[0];
        const startOffset = start + chunk.index + sub.index;
        const spokenForms = spokenFormsFor(displayText);
        tokens.push({
          id: tokens.length,
          paragraphId,
          displayText,
          normalized: normalizeWord(displayText),
          ...(spokenForms.length ? { spokenForms } : {}),
          startOffset,
          endOffset: startOffset + displayText.length,
        });
      }
    }
    paragraphs.push({
      id: paragraphId,
      startOffset: start,
      endOffset: end,
      firstTokenId,
      lastTokenId: tokens.length - 1,
    });
  }
  return { source, paragraphs, tokens };
}

/** [start, end) spans of paragraphs: runs of non-blank lines, trimmed of surrounding whitespace. */
function paragraphSpans(source: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let paraStart = -1;
  let paraEnd = -1;
  let lineStart = 0;
  while (lineStart <= source.length) {
    let lineEnd = source.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = source.length;
    const line = source.slice(lineStart, lineEnd);
    const firstNonWs = line.search(/\S/);
    if (firstNonWs === -1) {
      if (paraStart !== -1) spans.push([paraStart, paraEnd]);
      paraStart = -1;
    } else {
      if (paraStart === -1) paraStart = lineStart + firstNonWs;
      paraEnd = lineStart + line.trimEnd().length;
    }
    lineStart = lineEnd + 1;
  }
  if (paraStart !== -1) spans.push([paraStart, paraEnd]);
  return spans;
}
