import type { ParsedScript } from '../types';
import { DEFAULT_MATCHER_CONFIG, type MatcherConfig } from './config';

/**
 * Precomputed, script-specific data for matching. Only "matchable" tokens (those with a
 * normalized word) take part; positions below index this matchable list, not token ids.
 */
export type MatchContext = {
  config: MatcherConfig;
  tokenCount: number;
  /** Matchable position -> token id. */
  tokenIds: number[];
  /** Token id -> matchable position of the last matchable token at or before it (-1 if none). */
  positionAtOrBefore: Int32Array;
  /** Comparison key per position (normalized, apostrophes removed). */
  keys: string[];
  /** Multi-word spoken forms per position (split into keys), e.g. "2026" -> [[twenty, twenty, six]]. */
  multiForms: Array<string[][] | undefined>;
  /** Single-word alternative keys per position, e.g. "20" -> "twenty". */
  altKeys: Array<string[] | undefined>;
  idf: number[];
  fillers: Set<string>;
  fuzzyCache: Map<string, boolean>;
};

function wordKey(word: string): string {
  return word.replace(/'/g, '');
}

export function createMatchContext(
  script: ParsedScript,
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
): MatchContext {
  const tokenIds: number[] = [];
  const keys: string[] = [];
  const multiForms: Array<string[][] | undefined> = [];
  const altKeys: Array<string[] | undefined> = [];
  const positionAtOrBefore = new Int32Array(script.tokens.length);

  for (const token of script.tokens) {
    if (token.normalized || token.spokenForms?.length) {
      const forms = (token.spokenForms ?? []).map((f) => f.split(' ').map(wordKey));
      tokenIds.push(token.id);
      keys.push(wordKey(token.normalized));
      const multi = forms.filter((f) => f.length > 1);
      const single = forms.filter((f) => f.length === 1).map((f) => f[0]!);
      multiForms.push(multi.length ? multi : undefined);
      altKeys.push(single.length ? single : undefined);
    }
    positionAtOrBefore[token.id] = tokenIds.length - 1;
  }

  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const stop = new Set(config.stopWords.map(wordKey));
  const n = Math.max(1, keys.length);
  const idf = keys.map((k) => (stop.has(k) || !k ? 0 : Math.log(1 + n / counts.get(k)!)));

  return {
    config,
    tokenCount: script.tokens.length,
    tokenIds,
    positionAtOrBefore,
    keys,
    multiForms,
    altKeys,
    idf,
    fillers: new Set(config.fillerWords.map(wordKey)),
    fuzzyCache: new Map(),
  };
}

/** Matchable position of the anchor token (last spoken), or -1 before the start. */
export function positionOf(ctx: MatchContext, tokenId: number | null): number {
  if (tokenId === null || tokenId < 0) return -1;
  return ctx.positionAtOrBefore[Math.min(tokenId, ctx.tokenCount - 1)] ?? -1;
}
