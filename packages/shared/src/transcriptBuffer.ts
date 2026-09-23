import { normalizeSpokenText } from './normalize';
import type { TranscriptEvent } from './types';

/** Final words kept for matching; older words can no longer affect the rolling phrase. */
const MAX_FINAL_WORDS = 256;
const MAX_SEEN_SEGMENTS = 512;

/**
 * Finalized spoken words (in audio order) plus one replaceable interim tail. Word positions are
 * absolute: `dropped` counts words pruned from the front, so `dropped + i` is stable.
 */
export type TranscriptBuffer = {
  finalWords: readonly string[];
  finalOrders: readonly number[];
  dropped: number;
  /** Recently committed segment ids (bounded) for de-duplication. */
  seenFinals: readonly string[];
  /** Finals at or before this order were pruned; late duplicates of them are ignored. */
  prunedThroughOrder: number;
  interim: { segmentId: string; order: number; words: readonly string[]; sequence: number } | null;
};

export type BufferChange = 'final' | 'interim' | 'none';

export const EMPTY_BUFFER: TranscriptBuffer = {
  finalWords: [],
  finalOrders: [],
  dropped: 0,
  seenFinals: [],
  prunedThroughOrder: -Infinity,
  interim: null,
};

export function finalWordEnd(buf: TranscriptBuffer): number {
  return buf.dropped + buf.finalWords.length;
}

/**
 * Apply one transcript event. Interim events replace the interim tail (stale ones are ignored);
 * final events are inserted in segment order exactly once and clear the interim they replace.
 */
export function applyTranscriptEvent(
  buf: TranscriptBuffer,
  ev: TranscriptEvent,
): { buffer: TranscriptBuffer; change: BufferChange } {
  const words = normalizeSpokenText(ev.text);

  if (ev.kind === 'interim') {
    if (buf.seenFinals.includes(ev.segmentId) || ev.segmentOrder <= buf.prunedThroughOrder) {
      return { buffer: buf, change: 'none' };
    }
    if (buf.interim && ev.sequence < buf.interim.sequence) return { buffer: buf, change: 'none' };
    const prev = buf.interim;
    if (prev && prev.segmentId === ev.segmentId && sameWords(prev.words, words)) {
      return { buffer: { ...buf, interim: { ...prev, sequence: ev.sequence } }, change: 'none' };
    }
    return {
      buffer: {
        ...buf,
        interim: { segmentId: ev.segmentId, order: ev.segmentOrder, words, sequence: ev.sequence },
      },
      change: 'interim',
    };
  }

  if (buf.seenFinals.includes(ev.segmentId) || ev.segmentOrder <= buf.prunedThroughOrder) {
    return { buffer: buf, change: 'none' };
  }
  const seenFinals = [...buf.seenFinals, ev.segmentId].slice(-MAX_SEEN_SEGMENTS);
  // A final supersedes the interim for the same or an earlier part of the stream.
  const interim = buf.interim && buf.interim.order <= ev.segmentOrder ? null : buf.interim;

  if (!words.length) {
    return {
      buffer: { ...buf, seenFinals, interim },
      change: interim !== buf.interim ? 'interim' : 'none',
    };
  }

  // Insert in order (normally an append).
  let at = buf.finalOrders.length;
  while (at > 0 && buf.finalOrders[at - 1]! > ev.segmentOrder) at--;
  let finalWords = [...buf.finalWords.slice(0, at), ...words, ...buf.finalWords.slice(at)];
  let finalOrders = [
    ...buf.finalOrders.slice(0, at),
    ...words.map(() => ev.segmentOrder),
    ...buf.finalOrders.slice(at),
  ];
  let { dropped, prunedThroughOrder } = buf;
  const excess = finalWords.length - MAX_FINAL_WORDS;
  if (excess > 0) {
    prunedThroughOrder = Math.max(prunedThroughOrder, finalOrders[excess - 1]!);
    finalWords = finalWords.slice(excess);
    finalOrders = finalOrders.slice(excess);
    dropped += excess;
  }
  return {
    buffer: { finalWords, finalOrders, dropped, seenFinals, prunedThroughOrder, interim },
    change: 'final',
  };
}

/**
 * Words spoken after a watermark. The watermark marks everything heard up to a moment (e.g. a
 * manual reposition): final words before `finalIndex`, plus the first `skipCount` words of the
 * segment that was still interim at that moment (they will be finalized later).
 */
export type Watermark = { finalIndex: number; skipOrder: number | null; skipCount: number };

export function watermarkAtEnd(buf: TranscriptBuffer): Watermark {
  return {
    finalIndex: finalWordEnd(buf),
    skipOrder: buf.interim?.order ?? null,
    skipCount: buf.interim?.words.length ?? 0,
  };
}

export function wordsAfter(
  buf: TranscriptBuffer,
  mark: Watermark,
): { finalWords: string[]; interimWords: string[] } {
  const finalWords: string[] = [];
  let skipped = 0;
  for (let i = Math.max(0, mark.finalIndex - buf.dropped); i < buf.finalWords.length; i++) {
    if (buf.finalOrders[i] === mark.skipOrder && skipped < mark.skipCount) {
      skipped++;
      continue;
    }
    finalWords.push(buf.finalWords[i]!);
  }
  let interimWords = buf.interim ? [...buf.interim.words] : [];
  if (buf.interim && buf.interim.order === mark.skipOrder) {
    interimWords = interimWords.slice(mark.skipCount);
  }
  return { finalWords, interimWords };
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((w, i) => w === b[i]);
}
