import { describe, expect, it } from 'vitest';
import {
  EMPTY_BUFFER,
  applyTranscriptEvent,
  watermarkAtEnd,
  wordsAfter,
  type TranscriptBuffer,
} from './transcriptBuffer';
import type { TranscriptEvent } from './types';

let seq = 0;
function apply(buf: TranscriptBuffer, kind: 'interim' | 'final', text: string, order: number) {
  const ev: TranscriptEvent = {
    sessionId: 's',
    segmentId: `${kind}-${order}-${seq}`,
    segmentOrder: order,
    kind,
    text,
    sequence: seq++,
  };
  return applyTranscriptEvent(buf, ev).buffer;
}

describe('wordsAfter', () => {
  it('skips interim words heard before the watermark when they finalize as one segment', () => {
    let buf = apply(EMPTY_BUFFER, 'final', 'one two', 0);
    buf = apply(buf, 'interim', 'three four', 10);
    const mark = watermarkAtEnd(buf);
    buf = apply(buf, 'final', 'three four five', 10);
    expect(wordsAfter(buf, mark)).toEqual({ finalWords: ['five'], interimWords: [] });
  });

  it('skips them when they finalize a few words at a time (word-by-word providers)', () => {
    let buf = apply(EMPTY_BUFFER, 'interim', 'one two three', 0);
    const mark = watermarkAtEnd(buf);
    buf = apply(buf, 'final', 'one', 0);
    buf = apply(buf, 'interim', 'two three four', 1);
    expect(wordsAfter(buf, mark)).toEqual({ finalWords: [], interimWords: ['four'] });
    buf = apply(buf, 'final', 'two three four', 1);
    buf = apply(buf, 'interim', 'five', 4);
    expect(wordsAfter(buf, mark)).toEqual({ finalWords: ['four'], interimWords: ['five'] });
  });
});
