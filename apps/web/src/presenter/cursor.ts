import type { ParsedScript, TrackingState } from '@teleprompter/shared';

/** The parts of tracking state that determine what is highlighted. */
export type Cursor = Pick<TrackingState, 'confirmedTokenId' | 'tentativeTokenId'>;

/** The next token to read (the one the reading zone should show), or null for an empty script. */
export function focusTokenId(script: ParsedScript, cursor: Cursor): number | null {
  if (!script.tokens.length) return null;
  const last = cursor.tentativeTokenId ?? cursor.confirmedTokenId ?? -1;
  return Math.min(last + 1, script.tokens.length - 1);
}

export function currentParagraphId(script: ParsedScript, cursor: Cursor): number | null {
  const focus = focusTokenId(script, cursor);
  return focus === null ? null : script.tokens[focus]!.paragraphId;
}

/**
 * Token to reposition to when moving by paragraphs, or null if there is nowhere to go. Going
 * back from the middle of a paragraph returns to its start first.
 */
export function paragraphStepTarget(
  script: ParsedScript,
  cursor: Cursor,
  delta: 1 | -1,
): number | null {
  const focus = focusTokenId(script, cursor);
  if (focus === null) return null;
  const current = script.paragraphs[script.tokens[focus]!.paragraphId]!;
  if (delta === -1 && focus > current.firstTokenId) return current.firstTokenId;
  return script.paragraphs[current.id + delta]?.firstTokenId ?? null;
}
