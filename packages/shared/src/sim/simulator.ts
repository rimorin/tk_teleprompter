import type { ParsedScript, TranscriptEvent } from '../types';

/** Scripted deviations from a straight read, applied just before `atTokenId` would be spoken. */
export type SimAction =
  | { type: 'pause'; atTokenId: number; ms: number }
  | { type: 'skip'; atTokenId: number; toTokenId: number }
  | { type: 'adlib'; atTokenId: number; text: string }
  | { type: 'repeat'; atTokenId: number; fromTokenId: number }
  | { type: 'stop'; atTokenId: number };

export type SimOptions = {
  seed?: number;
  sessionId?: string;
  wordsPerMinute?: number;
  startTokenId?: number;
  /** Probability a spoken word is misrecognized. */
  substitutionRate?: number;
  /** Probability a filler word ("um") is inserted before a word. */
  fillerRate?: number;
  /** Probability an interim hypothesis garbles its last word (corrected in the next revision). */
  interimRevisionRate?: number;
  /** Emit an interim every N words within a segment. */
  interimEveryWords?: number;
  /** Segment (final) length range in words. */
  segmentWords?: [number, number];
  /** Delay between the end of speech in a segment and its final result. */
  finalLatencyMs?: number;
  actions?: SimAction[];
};

export type SimulatedEvent = {
  atMs: number;
  event: TranscriptEvent;
  /** Ground truth: last script token actually read when this event was produced (null if none). */
  truthTokenId: number | null;
};

type Spoken = { word: string; tokenId: number | null } | { pauseMs: number };

const FILLERS = ['um', 'uh', 'so'];
const CONFUSIONS = ['bananas', 'later', 'thing', 'okay', 'maybe', 'there', 'another'];

/** Small deterministic PRNG (mulberry32). */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wordsForToken(script: ParsedScript, tokenId: number): string[] {
  const token = script.tokens[tokenId]!;
  if (token.spokenForms?.length) return token.spokenForms[0]!.split(' ');
  return token.normalized ? [token.normalized] : [];
}

function garble(word: string, rng: () => number): string {
  if (word.length > 4 && rng() < 0.5) return word.slice(0, -2);
  return CONFUSIONS[Math.floor(rng() * CONFUSIONS.length)]!;
}

/** Build the sequence of spoken words following the script plus scripted actions. */
function speak(script: ParsedScript, opts: Required<SimOptions>, rng: () => number): Spoken[] {
  const out: Spoken[] = [];
  const actions = [...opts.actions];
  let id = opts.startTokenId;
  let guard = 0;
  while (id < script.tokens.length && guard++ < 100_000) {
    const idx = actions.findIndex((a) => a.atTokenId === id);
    if (idx !== -1) {
      const action = actions.splice(idx, 1)[0]!;
      if (action.type === 'stop') break;
      if (action.type === 'pause') out.push({ pauseMs: action.ms });
      if (action.type === 'adlib') {
        for (const w of action.text.toLowerCase().split(/\s+/).filter(Boolean)) {
          out.push({ word: w, tokenId: null });
        }
      }
      if (action.type === 'skip') {
        id = action.toTokenId;
        continue;
      }
      if (action.type === 'repeat') {
        id = action.fromTokenId;
        continue;
      }
      continue;
    }
    for (const w of wordsForToken(script, id)) {
      if (rng() < opts.fillerRate)
        out.push({ word: FILLERS[Math.floor(rng() * FILLERS.length)]!, tokenId: null });
      out.push({ word: rng() < opts.substitutionRate ? garble(w, rng) : w, tokenId: id });
    }
    id++;
  }
  return out;
}

/**
 * Deterministically simulate streaming ASR output for someone reading `script`, with optional
 * recognition errors, fillers, interim revisions, pauses, skips, ad-libs and re-reads.
 */
export function simulateReading(script: ParsedScript, options: SimOptions = {}): SimulatedEvent[] {
  const opts: Required<SimOptions> = {
    seed: 1,
    sessionId: 'sim',
    wordsPerMinute: 150,
    startTokenId: 0,
    substitutionRate: 0,
    fillerRate: 0,
    interimRevisionRate: 0,
    interimEveryWords: 2,
    segmentWords: [6, 12],
    finalLatencyMs: 300,
    actions: [],
    ...options,
  };
  const rng = createRng(opts.seed);
  const spoken = speak(script, opts, rng);
  const msPerWord = 60_000 / opts.wordsPerMinute;
  const events: SimulatedEvent[] = [];
  let sequence = 0;
  let t = 0;
  let segment: Array<{ word: string; tokenId: number | null }> = [];
  let segmentStart = 0;
  let segmentTarget = 0;
  let truth: number | null = opts.startTokenId > 0 ? opts.startTokenId - 1 : null;
  const pickTarget = () =>
    opts.segmentWords[0] + Math.floor(rng() * (opts.segmentWords[1] - opts.segmentWords[0] + 1));

  const emit = (kind: 'interim' | 'final', words: string[], atMs: number) => {
    events.push({
      atMs,
      truthTokenId: truth,
      event: {
        sessionId: opts.sessionId,
        segmentId: `${opts.sessionId}-${segmentStart}`,
        segmentOrder: segmentStart,
        kind,
        text: words.join(' '),
        sequence: sequence++,
      },
    });
  };
  const flush = () => {
    if (!segment.length) return;
    emit(
      'final',
      segment.map((s) => s.word),
      t + opts.finalLatencyMs,
    );
    segment = [];
  };

  for (const item of spoken) {
    if ('pauseMs' in item) {
      flush();
      t += item.pauseMs;
      continue;
    }
    if (!segment.length) {
      segmentStart = Math.round(t);
      segmentTarget = pickTarget();
    }
    segment.push(item);
    t += msPerWord;
    if (item.tokenId !== null) truth = item.tokenId;
    if (segment.length % opts.interimEveryWords === 0 && segment.length < segmentTarget) {
      const words = segment.map((s) => s.word);
      if (rng() < opts.interimRevisionRate)
        words[words.length - 1] = garble(words[words.length - 1]!, rng);
      emit('interim', words, t);
    }
    if (segment.length >= segmentTarget) flush();
  }
  flush();
  return events.sort((a, b) => a.atMs - b.atMs);
}
