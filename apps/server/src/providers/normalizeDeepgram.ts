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
  is_final: z.boolean().optional(),
  channel: z.object({
    alternatives: z
      .array(z.object({ transcript: z.string(), words: z.array(DeepgramWord).optional() }))
      .min(1),
  }),
});

/**
 * Map a Deepgram live `Results` message to a provider-independent transcript, or null for other
 * messages. Interim results are complete hypotheses for the unfinalized window starting at
 * `start` (each replaces the last; they are not deltas) and `is_final` locks it, so the window
 * start is both the segment id and its order.
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
