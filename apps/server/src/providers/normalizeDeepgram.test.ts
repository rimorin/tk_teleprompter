import { describe, expect, it } from 'vitest';
import { normalizeDeepgramMessage } from './normalizeDeepgram';

const results = (overrides: object = {}) => ({
  type: 'Results',
  channel_index: [0, 1],
  duration: 1.65,
  start: 2.5,
  is_final: false,
  speech_final: false,
  channel: {
    alternatives: [
      {
        transcript: 'testing one two three',
        confidence: 0.9,
        words: [
          { word: 'testing', punctuated_word: 'Testing', start: 2.51, end: 2.9, confidence: 0.7 },
          { word: 'one', start: 3.0, end: 3.2, confidence: 0.8 },
        ],
      },
    ],
  },
  metadata: { request_id: 'x' },
  from_finalize: false,
  ...overrides,
});

describe('normalizeDeepgramMessage', () => {
  it('maps an interim result, keyed by its audio window start', () => {
    expect(normalizeDeepgramMessage(results())).toEqual({
      kind: 'interim',
      segmentId: 'dg-2500',
      segmentOrder: 2500,
      text: 'testing one two three',
      words: [
        { text: 'Testing', startMs: 2510, endMs: 2900, confidence: 0.7 },
        { text: 'one', startMs: 3000, endMs: 3200, confidence: 0.8 },
      ],
    });
  });

  it('maps a final result for the same window to the same segment', () => {
    const final = normalizeDeepgramMessage(results({ is_final: true, speech_final: true }));
    expect(final?.kind).toBe('final');
    expect(final?.segmentId).toBe('dg-2500');
  });

  it('keeps empty finals (they clear the interim) and omits empty word lists', () => {
    const t = normalizeDeepgramMessage(
      results({ is_final: true, channel: { alternatives: [{ transcript: '', words: [] }] } }),
    );
    expect(t).toEqual({ kind: 'final', segmentId: 'dg-2500', segmentOrder: 2500, text: '' });
  });

  it('ignores other message types and malformed input', () => {
    expect(normalizeDeepgramMessage({ type: 'Metadata', request_id: 'x' })).toBeNull();
    expect(normalizeDeepgramMessage({ type: 'SpeechStarted', timestamp: 1 })).toBeNull();
    expect(normalizeDeepgramMessage({ type: 'UtteranceEnd', last_word_end: 2 })).toBeNull();
    expect(
      normalizeDeepgramMessage({ type: 'Results', start: 1, channel: { alternatives: [] } }),
    ).toBeNull();
    expect(normalizeDeepgramMessage('nope')).toBeNull();
  });
});
