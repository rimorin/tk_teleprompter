import type { OutlineBullet, ParsedScript, TrackingState } from '@teleprompter/shared';

/** The parts of tracking state that determine what is highlighted. */
export type Cursor = Pick<TrackingState, 'confirmedTokenId' | 'tentativeTokenId'>;

/** What the presenter steps through: paragraphs, with each outline bullet its own section. */
export type Section = { firstTokenId: number; lastTokenId: number; bullet: boolean };

/** The next token to read (the one the reading zone should show), or null for an empty script. */
export function focusTokenId(script: ParsedScript, cursor: Cursor): number | null {
  if (!script.tokens.length) return null;
  const last = cursor.tentativeTokenId ?? cursor.confirmedTokenId ?? -1;
  return Math.min(last + 1, script.tokens.length - 1);
}

/** Paragraphs in order, split at outline bullets (which start at their marker). */
export function sections(script: ParsedScript, bullets: readonly OutlineBullet[]): Section[] {
  const out: Section[] = [];
  let b = 0;
  for (const p of script.paragraphs) {
    let from = p.firstTokenId;
    while (b < bullets.length && bullets[b]!.startTokenId <= p.lastTokenId) {
      const { startTokenId, lastTokenId } = bullets[b++]!;
      if (startTokenId > from)
        out.push({ firstTokenId: from, lastTokenId: startTokenId - 1, bullet: false });
      out.push({ firstTokenId: startTokenId, lastTokenId, bullet: true });
      from = lastTokenId + 1;
    }
    if (from <= p.lastTokenId)
      out.push({ firstTokenId: from, lastTokenId: p.lastTokenId, bullet: false });
  }
  return out;
}

/** Index of the section holding the focus, or null for an empty script. */
export function currentSection(
  script: ParsedScript,
  secs: readonly Section[],
  cursor: Cursor,
): number | null {
  const focus = focusTokenId(script, cursor);
  if (focus === null) return null;
  const i = secs.findIndex((s) => focus <= s.lastTokenId);
  return i === -1 ? secs.length - 1 : i;
}

/**
 * Token to reposition to when moving by sections, or null if there is nowhere to go. Going
 * back from the middle of a section returns to its start first.
 */
export function sectionStepTarget(
  script: ParsedScript,
  secs: readonly Section[],
  cursor: Cursor,
  delta: 1 | -1,
): number | null {
  const i = currentSection(script, secs, cursor);
  if (i === null) return null;
  const focus = focusTokenId(script, cursor)!;
  if (delta === -1 && focus > secs[i]!.firstTokenId) return secs[i]!.firstTokenId;
  return secs[i + delta]?.firstTokenId ?? null;
}

/** First token of the few words quoted for a jump suggestion (never before its paragraph). */
export function jumpSnippetStart(script: ParsedScript, tokenId: number): number {
  const paragraph = script.paragraphs[script.tokens[tokenId]!.paragraphId]!;
  return Math.max(paragraph.firstTokenId, tokenId - 4);
}
