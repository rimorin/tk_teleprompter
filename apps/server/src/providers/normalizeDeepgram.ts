import { z } from 'zod';
import type { ProviderTranscript } from './AsrProvider';

const DeepgramWord = z.object({
  word: z.string(),
  punctuated_word: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
  confidence: z.number().optional(),
});

const DeepgramResults = z.object({
  type: z.literal('Results'),
  start: z.number(),
  duration: z.number().optional(),
  is_final: z.boolean().optional(),
  speech_final: z.boolean().optional(),
  channel: z.object({
    alternatives: z
      .array(z.object({ transcript: z.string(), words: z.array(DeepgramWord).optional() }))
      .min(1),
  }),
});

/**
 * Map a Deepgram live `Results` message to a provider-independent transcript.
 *
 * Deepgram v1 streaming semantics: each Results message covers an audio window starting at
 * `start`. With interim_results, `is_final: false` messages are complete hypotheses for the
 * not-yet-finalized window (each replaces the previous one, they are not deltas);
 * `is_final: true` locks that window. `speech_final` only marks an endpoint and is not needed
 * for ordering. The window start (ms) is therefore both the segment id and its order.
 *
 * Returns null for non-Results messages (Metadata, SpeechStarted, UtteranceEnd) or bad input.
 */
export function normalizeDeepgramMessage(raw: unknown): ProviderTranscript | null {
  const parsed = DeepgramResults.safeParse(raw);
  if (!parsed.success) return null;
  const msg = parsed.data;
  const alt = msg.channel.alternatives[0]!;
  const segmentOrder = Math.round(msg.start * 1000);
  return {
    kind: msg.is_final ? 'final' : 'interim',
    segmentId: `dg-${segmentOrder}`,
    segmentOrder,
    text: alt.transcript,
    ...(alt.words?.length
      ? {
          words: alt.words.map((w) => ({
            text: w.punctuated_word ?? w.word,
            ...(w.start !== undefined ? { startMs: Math.round(w.start * 1000) } : {}),
            ...(w.end !== undefined ? { endMs: Math.round(w.end * 1000) } : {}),
            ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
          })),
        }
      : {}),
  };
}
