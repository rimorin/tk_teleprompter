import { z } from 'zod';
import type { ProviderTranscript } from './AsrProvider';

const AssemblyAiWord = z.object({
  text: z.string(),
  start: z.number().optional(),
  end: z.number().optional(),
  confidence: z.number().optional(),
  word_is_final: z.boolean(),
});

const AssemblyAiTurn = z.object({
  type: z.literal('Turn'),
  turn_order: z.number().int().min(0),
  end_of_turn: z.boolean(),
  words: z.array(AssemblyAiWord),
});

/** Segment orders: turn, then word position within the turn. */
const WORDS_PER_TURN = 1_000_000;

/**
 * Map AssemblyAI Universal-Streaming `Turn` messages to provider-independent transcripts. Every
 * message carries the whole current turn, and each word is marked final once it can no longer
 * change (usually well before the turn ends). So each newly finalized run of words becomes its
 * own final segment, and the words not yet final become the interim. Stateful: one per stream,
 * since it remembers how much of the current turn was already sent as final.
 */
export function createAssemblyAiNormalizer(): (raw: unknown) => ProviderTranscript[] {
  let turn = -1;
  let sent = 0;
  return (raw) => {
    const parsed = AssemblyAiTurn.safeParse(raw);
    if (!parsed.success) return [];
    const msg = parsed.data;
    if (msg.turn_order !== turn) {
      turn = msg.turn_order;
      sent = 0;
    }
    const firstTentative = msg.words.findIndex((w) => !w.word_is_final);
    const finalCount =
      msg.end_of_turn || firstTentative < 0 ? msg.words.length : Math.max(sent, firstTentative);
    const out: ProviderTranscript[] = [];
    if (finalCount > sent) {
      out.push(segment('final', turn, sent, msg.words.slice(sent, finalCount)));
      sent = finalCount;
    }
    out.push(segment('interim', turn, sent, msg.words.slice(sent)));
    return out;
  };
}

function segment(
  kind: ProviderTranscript['kind'],
  turn: number,
  from: number,
  words: z.infer<typeof AssemblyAiWord>[],
): ProviderTranscript {
  const segmentOrder = turn * WORDS_PER_TURN + from;
  return {
    kind,
    segmentId: `aai-${turn}-${from}`,
    segmentOrder,
    text: words.map((w) => w.text).join(' '),
    ...(words.length
      ? {
          words: words.map((w) => ({
            text: w.text,
            ...(w.start !== undefined ? { startMs: w.start } : {}),
            ...(w.end !== undefined ? { endMs: w.end } : {}),
            ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
          })),
        }
      : {}),
  };
}
