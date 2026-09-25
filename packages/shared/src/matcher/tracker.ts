import {
  applyTranscriptEvent,
  EMPTY_BUFFER,
  finalWordEnd,
  watermarkAtEnd,
  wordsAfter,
  type TranscriptBuffer,
  type Watermark,
} from '../transcriptBuffer';
import type { TrackingStatus, TranscriptEvent } from '../types';
import { alignPhrase, type AlignmentCandidate } from './align';
import { positionOf, type MatchContext } from './context';

export type MatchDecision = {
  /**
   * local: ordinary forward progress · hold: speech matched text at/behind the cursor (re-read) ·
   * far-pending: distinctive distant match awaiting agreement · far: controlled forward jump ·
   * none: no acceptable match.
   */
  kind: 'local' | 'hold' | 'far-pending' | 'far' | 'none';
  phrase: string[];
  tokenId: number | null;
  score: number | null;
  distinctiveness: number | null;
};

export type TrackingState = {
  /** Last script token confirmed as spoken (null = before the start). Authoritative. */
  confirmedTokenId: number | null;
  /** Last token tentatively spoken per the current interim hypothesis. Always > confirmed. */
  tentativeTokenId: number | null;
  status: TrackingStatus;
  sessionId: string | null;
  transcript: TranscriptBuffer;
  /** Speech heard before this mark (e.g. before a reposition) is ignored. */
  watermark: Watermark;
  /** Absolute final-word position when the confirmed cursor was last matched/anchored. */
  finalIndexAtLastMatch: number;
  /** Consecutive final updates with no acceptable match. */
  misses: number;
  /**
   * Distant candidate awaiting agreement: `words` spoken so far that support it, counted up to
   * absolute final-word position `countedTo`. `stale` after one update that didn't support it.
   */
  pendingJump: { position: number; words: number; countedTo: number; stale?: boolean } | null;
  /**
   * Last token of a distant place the speaker seems to have skipped to (null = none). Only a
   * suggestion the presenter can accept with a tap: it never moves either cursor. Set from
   * pending jumps and from interims, so it appears before the evidence is enough to jump.
   */
  jumpSuggestion: number | null;
  /**
   * A new provider session began after an earlier one (a lost connection): the speaker kept
   * talking meanwhile, so is likely ahead. Until speech matches again, interim results may move
   * the tentative cursor as far as a final could (a skip-grade match within the local window).
   */
  resyncing: boolean;
  lastDecision: MatchDecision | null;
};

const START_WATERMARK: Watermark = { finalIndex: 0, skipOrder: null, skipCount: 0 };

export function initialTrackingState(): TrackingState {
  return {
    confirmedTokenId: null,
    tentativeTokenId: null,
    status: 'idle',
    sessionId: null,
    transcript: EMPTY_BUFFER,
    watermark: START_WATERMARK,
    finalIndexAtLastMatch: 0,
    misses: 0,
    pendingJump: null,
    jumpSuggestion: null,
    resyncing: false,
    lastDecision: null,
  };
}

function isTrackingActive(status: TrackingStatus): boolean {
  return status === 'tracking' || status === 'uncertain';
}

/**
 * Pure tracking step: fold one transcript event into the state. Interim events can only move
 * the tentative cursor; final events can move the confirmed cursor forward (never backward).
 */
export function update(
  ctx: MatchContext,
  state: TrackingState,
  ev: TranscriptEvent,
): TrackingState {
  let base = state;
  if (ev.sessionId !== state.sessionId) {
    // New provider session: segment ids/orders restart, so start a fresh transcript.
    base = {
      ...state,
      sessionId: ev.sessionId,
      transcript: EMPTY_BUFFER,
      watermark: START_WATERMARK,
      finalIndexAtLastMatch: 0,
      resyncing: state.sessionId !== null,
    };
  }
  const { buffer, change } = applyTranscriptEvent(base.transcript, ev);
  let next: TrackingState = { ...base, transcript: buffer };
  if (change === 'none' || !isTrackingActive(next.status)) return next;

  const { finalWords, interimWords } = wordsAfter(buffer, next.watermark);
  if (change === 'final') {
    next = updateConfirmed(ctx, next, finalWords);
    const pending = next.pendingJump;
    next = { ...next, jumpSuggestion: pending ? ctx.tokenIds[pending.position]! : null };
  }
  return updateTentative(ctx, next, finalWords, interimWords, change === 'interim');
}

type Scored = AlignmentCandidate & { adjusted: number; phrase: string[] };

function skipExcess(ctx: MatchContext, distance: number, newWords: number): number {
  return distance - newWords - ctx.config.distanceFreeSlack;
}

function distancePenalty(ctx: MatchContext, distance: number, newWords: number): number {
  // Tiny tie-breaker keeps the nearest of otherwise equal candidates.
  return (
    Math.max(0, skipExcess(ctx, distance, newWords)) * ctx.config.distancePenaltyPerToken +
    Math.abs(distance) * 1e-4
  );
}

/**
 * Best local candidate, trying the longest phrase suffix first. Candidates that skip ahead of
 * the expected position need stronger evidence; with `allowSkip` false they are excluded.
 */
function bestLocal(
  ctx: MatchContext,
  phrase: string[],
  anchorPos: number,
  newWords: number,
  hi: number,
  minWords: number,
  threshold: number,
  allowSkip = true,
): Scored | null {
  const cfg = ctx.config;
  const lo = anchorPos - cfg.localBackSlack;
  for (let s = 0; phrase.length - s >= minWords; s++) {
    const sub = phrase.slice(s);
    let best: Scored | null = null;
    for (const c of alignPhrase(ctx, sub, lo, hi)) {
      if (c.matchedWords < minWords) continue;
      const distance = c.endPosition - anchorPos;
      const adjusted = c.score - distancePenalty(ctx, distance, newWords);
      if (skipExcess(ctx, distance, newWords) > 0) {
        if (!allowSkip || c.matchedWords < cfg.localSkipMinWords) continue;
        if (adjusted < cfg.localSkipThreshold) continue;
      }
      if (!best || adjusted > best.adjusted) best = { ...c, adjusted, phrase: sub };
    }
    if (best && best.adjusted >= threshold) return best;
  }
  return null;
}

/** Distinctive, unique forward match anywhere after the anchor, or null. */
function bestFar(ctx: MatchContext, phrase: string[], anchorPos: number): Scored | null {
  const cfg = ctx.config;
  for (let s = 0; phrase.length - s >= cfg.farMinWords; s++) {
    const sub = phrase.slice(s);
    // Align against the whole script so identical passages elsewhere (even behind) compete.
    const cands = alignPhrase(ctx, sub, 0, ctx.keys.length - 1);
    let best: AlignmentCandidate | null = null;
    for (const c of cands) {
      if (c.endPosition <= anchorPos + 1) continue;
      if (!best || c.score > best.score + 1e-9) best = c;
    }
    if (!best) continue;
    let competitor = -Infinity;
    for (const c of cands) {
      if (Math.abs(c.endPosition - best.endPosition) > cfg.farCompetitorMinGap) {
        competitor = Math.max(competitor, c.score);
      }
    }
    if (
      best.score >= cfg.farThreshold &&
      best.matchedWords >= cfg.farMinWords &&
      best.distinctiveness >= cfg.farMinDistinctiveness &&
      best.score - competitor >= cfg.farUniquenessMargin
    ) {
      return { ...best, adjusted: best.score, phrase: sub };
    }
  }
  return null;
}

function decision(
  kind: MatchDecision['kind'],
  ctx: MatchContext,
  c: Scored | null,
  phrase: string[],
): MatchDecision {
  return {
    kind,
    phrase: c?.phrase ?? phrase,
    tokenId: c ? ctx.tokenIds[c.endPosition]! : null,
    score: c ? c.adjusted : null,
    distinctiveness: c ? c.distinctiveness : null,
  };
}

function updateConfirmed(
  ctx: MatchContext,
  state: TrackingState,
  finalWords: string[],
): TrackingState {
  const cfg = ctx.config;
  const end = finalWordEnd(state.transcript);
  const newWords = Math.max(0, Math.min(finalWords.length, end - state.finalIndexAtLastMatch));
  if (newWords === 0) return state;
  const phrase = finalWords.slice(-cfg.phraseWords);
  if (phrase.length < cfg.minLocalWords) return state; // Not enough evidence yet; not a miss.

  const anchorPos = positionOf(ctx, state.confirmedTokenId);
  const pending = state.pendingJump;
  const agreesWithPending = (c: Scored) =>
    pending !== null &&
    c.endPosition >= pending.position &&
    c.endPosition <= pending.position + cfg.farAgreementWindow;
  let local = bestLocal(
    ctx,
    phrase,
    anchorPos,
    newWords,
    anchorPos + (state.resyncing ? cfg.resyncForward : cfg.localForward),
    cfg.minLocalWords,
    cfg.localThreshold,
  );
  // Script words followed by an ad-lib in the same segment: the tail won't match, so also try
  // phrases ending earlier among the new words and keep the first that makes forward progress.
  for (let cut = 1; (!local || local.endPosition <= anchorPos) && cut < newWords; cut++) {
    const truncated = finalWords.slice(0, finalWords.length - cut).slice(-cfg.phraseWords);
    if (truncated.length < cfg.minLocalWords) break;
    const candidate = bestLocal(
      ctx,
      truncated,
      anchorPos,
      newWords - cut,
      anchorPos + (state.resyncing ? cfg.resyncForward : cfg.localForward),
      cfg.minLocalWords,
      cfg.localThreshold,
      false,
    );
    if (candidate && candidate.endPosition > anchorPos) local = candidate;
  }
  let far: Scored | null = null;
  if (local && pending && local.adjusted < cfg.farThreshold) {
    // A weak local match (often just common words) must not cancel a pending jump that this
    // update's distinctive evidence confirms.
    far = bestFar(ctx, phrase, anchorPos);
    if (far && agreesWithPending(far)) local = null;
    else far = null;
  }

  if (local) {
    const matched: TrackingState = {
      ...state,
      status: 'tracking',
      misses: 0,
      pendingJump: null,
      resyncing: false,
      finalIndexAtLastMatch: end,
    };
    if (local.endPosition <= anchorPos) {
      return { ...matched, lastDecision: decision('hold', ctx, local, phrase) };
    }
    return {
      ...matched,
      confirmedTokenId: ctx.tokenIds[local.endPosition]!,
      lastDecision: decision('local', ctx, local, phrase),
    };
  }

  const misses = state.misses + 1;
  far ??= bestFar(ctx, phrase, anchorPos);
  if (far) {
    // Count each spoken word once, however the provider splits speech into finals.
    const words =
      pending && agreesWithPending(far)
        ? pending.words + Math.min(end - pending.countedTo, far.matchedWords)
        : far.matchedWords;
    if (words >= cfg.farConfirmWords) {
      return {
        ...state,
        confirmedTokenId: ctx.tokenIds[far.endPosition]!,
        status: 'tracking',
        misses: 0,
        pendingJump: null,
        resyncing: false,
        finalIndexAtLastMatch: end,
        lastDecision: decision('far', ctx, far, phrase),
      };
    }
    return {
      ...state,
      misses,
      status: misses >= cfg.uncertainAfterMisses ? 'uncertain' : state.status,
      pendingJump: { position: far.endPosition, words, countedTo: end },
      lastDecision: decision('far-pending', ctx, far, phrase),
    };
  }

  return {
    ...state,
    misses,
    status: misses >= cfg.uncertainAfterMisses ? 'uncertain' : state.status,
    // One unrecognizable update (e.g. a badly misheard segment) doesn't cancel a pending jump.
    pendingJump: pending && !pending.stale ? { ...pending, stale: true } : null,
    lastDecision: decision('none', ctx, null, phrase),
  };
}

function updateTentative(
  ctx: MatchContext,
  state: TrackingState,
  finalWords: string[],
  interimWords: string[],
  /** An unmatched interim revision (often a still-garbled last word) keeps the previous tentative. */
  keepOnMiss: boolean,
): TrackingState {
  const cfg = ctx.config;
  if (!interimWords.length) {
    return state.tentativeTokenId === null ? state : { ...state, tentativeTokenId: null };
  }
  const phrase = [...finalWords, ...interimWords].slice(-cfg.phraseWords);
  const anchorPos = positionOf(ctx, state.confirmedTokenId);
  // Normally a guess may run only a few words ahead; while resyncing it may skip like a final.
  const hi = state.resyncing
    ? anchorPos + cfg.resyncForward
    : anchorPos + interimWords.length + cfg.tentativeMaxLead;
  const best = bestLocal(
    ctx,
    phrase,
    anchorPos,
    interimWords.length,
    hi,
    cfg.minTentativeWords,
    cfg.tentativeThreshold,
  );
  const onTrack = best !== null && best.endPosition > anchorPos;
  const tentativeTokenId = onTrack
    ? ctx.tokenIds[best.endPosition]!
    : keepOnMiss
      ? state.tentativeTokenId
      : null;
  let jumpSuggestion = state.jumpSuggestion;
  if (onTrack) jumpSuggestion = null;
  else if (keepOnMiss && phrase.length >= cfg.farMinWords) {
    // Lost locally: look for a distant match now instead of waiting for the next final.
    const far = bestFar(ctx, phrase, anchorPos);
    if (far) jumpSuggestion = ctx.tokenIds[far.endPosition]!;
  }
  return tentativeTokenId === state.tentativeTokenId && jumpSuggestion === state.jumpSuggestion
    ? state
    : { ...state, tentativeTokenId, jumpSuggestion };
}

/** Manual reposition: `tokenId` becomes the next token to read; earlier speech is ignored. */
export function reposition(state: TrackingState, tokenId: number): TrackingState {
  return {
    ...state,
    confirmedTokenId: tokenId > 0 ? tokenId - 1 : null,
    tentativeTokenId: null,
    status: state.status === 'uncertain' ? 'tracking' : state.status,
    watermark: watermarkAtEnd(state.transcript),
    finalIndexAtLastMatch: finalWordEnd(state.transcript),
    misses: 0,
    pendingJump: null,
    jumpSuggestion: null,
    resyncing: false,
    lastDecision: null,
  };
}

/** Begin or resume following speech from the current confirmed position. */
export function startTracking(state: TrackingState): TrackingState {
  return {
    ...state,
    status: 'tracking',
    tentativeTokenId: null,
    watermark: watermarkAtEnd(state.transcript),
    finalIndexAtLastMatch: finalWordEnd(state.transcript),
    misses: 0,
    pendingJump: null,
    jumpSuggestion: null,
  };
}

function halt(state: TrackingState, status: TrackingStatus): TrackingState {
  return { ...state, status, tentativeTokenId: null, pendingJump: null, jumpSuggestion: null };
}

export const pauseTracking = (state: TrackingState) => halt(state, 'paused');
export const stopTracking = (state: TrackingState) => halt(state, 'idle');
/** Connection lost: freeze automatic tracking, keep the confirmed cursor. */
export const markDisconnected = (state: TrackingState) => halt(state, 'disconnected');
