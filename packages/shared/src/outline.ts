import type { ParsedScript } from './types';

/** One top-level outline bullet; its sub-bullets are folded into its token range. */
export type OutlineBullet = {
  /** First token of the bullet's line: its marker ("-", "1."). */
  startTokenId: number;
  /** First and last tokens of its text, without the marker. */
  firstTokenId: number;
  lastTokenId: number;
};

/** A list line: "- point", "* point", "• point", "1. point", "2) point". */
const LIST_ITEM = /^([ \t]*)(?:[-*•–]|\d{1,2}[.)])[ \t]+\S/;

type Item = { indent: number; start: number; contentStart: number; end: number };

/**
 * Outline bullets: top-level list items of at most `maxWords` words, each with the sub-items
 * under it. A longer item is a script sentence written as a list, so it and its sub-items stay
 * prose. A non-list line ends a list; blank lines don't.
 */
export function findOutlineBullets(script: ParsedScript, maxWords: number): OutlineBullet[] {
  const groups: Item[][] = [];
  let top: Item[] | null = null;
  let lineStart = 0;
  for (const line of script.source.split('\n')) {
    const m = LIST_ITEM.exec(line);
    if (m) {
      const indent = m[1]!.replace(/\t/g, '    ').length;
      const item = {
        indent,
        start: lineStart + m[1]!.length,
        contentStart: lineStart + m[0].length - 1,
        end: lineStart + line.trimEnd().length,
      };
      if (top && indent > top[0]!.indent) top.push(item);
      else groups.push((top = [item]));
    } else if (line.trim()) {
      top = null;
    }
    lineStart += line.length + 1;
  }

  const bullets: OutlineBullet[] = [];
  for (const group of groups) {
    const head = group[0]!;
    const headTokens = tokensIn(script, head.contentStart, head.end);
    const words = headTokens.filter((t) => script.tokens[t]!.normalized).length;
    if (!words || words > maxWords) continue;
    const all = tokensIn(script, head.contentStart, group[group.length - 1]!.end);
    bullets.push({
      startTokenId: tokensIn(script, head.start, head.end)[0]!,
      firstTokenId: all[0]!,
      lastTokenId: all[all.length - 1]!,
    });
  }
  return bullets;
}

function tokensIn(script: ParsedScript, start: number, end: number): number[] {
  return script.tokens.filter((t) => t.startOffset >= start && t.endOffset <= end).map((t) => t.id);
}
