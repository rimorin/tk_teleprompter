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
import {
  initialOutlineState,
  tentativeOutlineBullet,
  updateOutline,
  type OutlineState,
} from './outline';

export type MatchDecision = {
  /**
   * local: ordinary forward progress · hold: speech matched text at/behind the cursor (re-read) ·
   * far-pending: distinctive distant match awaiting agreement · far: controlled forward jump ·
   * none: no acceptable match · outline: following an outline bullet by bullet.
   */
  kind: 'local' | 'hold' | 'far-pending' | 'far' | 'none' | 'outline';
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
   * absolute final-word position `countedTo`. `missed`: updates since that didn't support it.
   */
  pendingJump: { position: number; words: number; countedTo: number; missed: number } | null;
  /**
   * Last token of a distant place the speaker seems to have skipped to (null = none). Only a
   * suggestion the presenter can accept with a tap: it never moves either cursor. Set from
   * pending jumps and from interims, so it appears before the evidence is enough to jump.
   */
  jumpSuggestion: number | null;
  /**
   * A new provider session began after an earlier one (a lost connection): the speaker kept
   * talking meanwhile, so is likely ahead. Until speech matches again, the local window reaches
   * further forward (a skip still needs skip-grade evidence).
   */
  resyncing: boolean;
  /**
   * While the reading focus is in an outline run: which run, and the bullet tracking there
   * (null in prose). The cursor sits just before the current bullet's line.
   */
  outline: { run: number; state: OutlineState } | null;
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
    outline: null,
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
    const added = finalWordEnd(buffer) - finalWordEnd(base.transcript);
    const at = outlineAt(ctx, next.confirmedTokenId);
    next = at
      ? updateOutlineConfirmed(ctx, next, at, finalWords, added)
      : updateConfirmed(ctx, next, finalWords, added);
    const pending = next.pendingJump;
    next = { ...next, jumpSuggestion: pending ? ctx.tokenIds[pending.position]! : null };
  }
  const at = outlineAt(ctx, next.confirmedTokenId);
  return at
    ? updateOutlineTentative(ctx, next, at, interimWords, change === 'interim')
    : updateTentative(ctx, next, finalWords, interimWords, change === 'interim');
}

type OutlinePlace = { run: number; bullet: number };

/** The outline run and bullet the reading focus (the next token) is in, or null in prose. */
function outlineAt(ctx: MatchContext, confirmedTokenId: number | null): OutlinePlace | null {
  const focus = (confirmedTokenId ?? -1) + 1;
  const run = ctx.outlines.findIndex((r) => focus >= r.startTokenId && focus <= r.lastTokenId);
  if (run === -1) return null;
  const { bullets } = ctx.outlines[run]!.outline;
  let bullet = 0;
  while (bullet + 1 < bullets.length && bullets[bullet + 1]!.startTokenId <= focus) bullet++;
  return { run, bullet };
}

/** The outline state at `at`, carried over if tracking was already there. */
function outlineStateAt(ctx: MatchContext, state: TrackingState, at: OutlinePlace): OutlineState {
  const o = state.outline;
  return o && o.run === at.run && o.state.bullet === at.bullet
    ? o.state
    : initialOutlineState(ctx.outlines[at.run]!.outline, at.bullet);
}

/** Cursor for being on `bullet`: just before its line, so the focus is on it. */
function beforeBullet(ctx: MatchContext, at: OutlinePlace, bullet: number): number | null {
  const id = ctx.outlines[at.run]!.outline.bullets[bullet]!.startTokenId - 1;
  return id < 0 ? null : id;
}

function updateOutlineConfirmed(
  ctx: MatchContext,
  state: TrackingState,
  at: OutlinePlace,
  finalWords: string[],
  added: number,
): TrackingState {
  if (added <= 0) return state;
  const cfg = ctx.config;
  const run = ctx.outlines[at.run]!;
  const end = finalWordEnd(state.transcript);
  const words = finalWords.slice(-added);
  // Only this final's words, so evidence already counted can't vouch for a move again.
  const readFrom = (tokenId: number) =>
    updateConfirmed(
      ctx,
      {
        ...state,
        confirmedTokenId: tokenId,
        finalIndexAtLastMatch: end - added,
        pendingJump: null,
      },
      words,
      added,
    );
  // Reading on into the script after the outline hands back to word-by-word matching. Free
  // speech can share common words with that script, or quote it, so it takes a distinctive
  // phrase (pending, shown as a jump suggestion), then another reading on from there.
  const readOn = (from: number) => {
    const next = readFrom(from);
    const d = next.lastDecision;
    return (next.confirmedTokenId ?? -1) > from &&
      d?.kind === 'local' &&
      d.phrase.length >= cfg.farMinWords &&
      (d.distinctiveness ?? 0) >= cfg.farMinDistinctiveness
      ? next
      : null;
  };
  const pending = state.pendingJump;
  const confirmed = pending && readOn(ctx.tokenIds[pending.position]!);
  if (confirmed) return { ...confirmed, outline: null };
  const prose = readOn(run.lastTokenId);
  const pendingJump = prose
    ? {
        position: positionOf(ctx, prose.confirmedTokenId),
        words: prose.lastDecision!.phrase.length,
        countedTo: end,
        missed: 0,
      }
    : pending && pending.missed < cfg.farPendingMaxMisses
      ? { ...pending, missed: pending.missed + 1 }
      : null;

  const before = outlineStateAt(ctx, state, at);
  const o = updateOutline(run.outline, before, words);
  return {
    ...state,
    confirmedTokenId:
      o.bullet > before.bullet ? beforeBullet(ctx, at, o.bullet) : state.confirmedTokenId,
    status: o.quietWords >= cfg.outline.uncertainAfterWords ? 'uncertain' : 'tracking',
    misses: 0,
    pendingJump,
    finalIndexAtLastMatch: end,
    outline: { run: at.run, state: o },
    lastDecision: {
      kind: 'outline',
      phrase: words,
      tokenId: run.outline.bullets[o.bullet]!.firstTokenId,
      score: o.belief[o.bullet]!,
      distinctiveness: null,
    },
  };
}

function updateOutlineTentative(
  ctx: MatchContext,
  state: TrackingState,
  at: OutlinePlace,
  interimWords: string[],
  /** An unmatched interim revision keeps the previous tentative. */
  keepOnMiss: boolean,
): TrackingState {
  let tentativeTokenId: number | null = null;
  if (interimWords.length) {
    const outline = ctx.outlines[at.run]!.outline;
    const bullet = tentativeOutlineBullet(outline, outlineStateAt(ctx, state, at), interimWords);
    if (bullet !== null) tentativeTokenId = beforeBullet(ctx, at, bullet);
    else if (keepOnMiss) tentativeTokenId = state.tentativeTokenId;
  }
  if (tentativeTokenId !== null && tentativeTokenId <= (state.confirmedTokenId ?? -1)) {
    tentativeTokenId = null;
  }
  return tentativeTokenId === state.tentativeTokenId ? state : { ...state, tentativeTokenId };
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

/** Best score among candidates that are a different place than `endPosition`. */
function competitorScore(ctx: MatchContext, cands: AlignmentCandidate[], endPosition: number) {
  let competitor = -Infinity;
  for (const c of cands) {
    if (Math.abs(c.endPosition - endPosition) > ctx.config.farCompetitorMinGap) {
      competitor = Math.max(competitor, c.score);
    }
  }
  return competitor;
}

/**
 * A local move beyond what the speech since the last match can explain (`words`) is kept only
 * if its phrase matches nowhere else in the script nearly as well: a phrase repeated in the
 * script (e.g. "at the end of the day"), said as an aside, is no evidence of a skip.
 */
function uniqueIfSkip(ctx: MatchContext, c: Scored | null, anchorPos: number, words: number) {
  if (!c || skipExcess(ctx, c.endPosition - anchorPos, words) <= 0) return c;
  const cands = alignPhrase(ctx, c.phrase, 0, ctx.keys.length - 1);
  return c.score - competitorScore(ctx, cands, c.endPosition) >= ctx.config.farUniquenessMargin
    ? c
    : null;
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
    const competitor = competitorScore(ctx, cands, best.endPosition);
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
  /** Final words this update added. */
  added: number,
): TrackingState {
  const cfg = ctx.config;
  const end = finalWordEnd(state.transcript);
  const newWords = Math.max(0, Math.min(finalWords.length, end - state.finalIndexAtLastMatch));
  if (newWords === 0) return state;
  const phrase = finalWords.slice(-cfg.phraseWords);
  if (phrase.length < cfg.minLocalWords) return state; // Not enough evidence yet; not a miss.

  const anchorPos = positionOf(ctx, state.confirmedTokenId);
  // Measured from where the speaker would be after the new words, so a long final that reads
  // on past a skip still falls inside the window.
  const hi = anchorPos + newWords + (state.resyncing ? cfg.resyncForward : cfg.localForward);
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
    hi,
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
      hi,
      cfg.minLocalWords,
      cfg.localThreshold,
      false,
    );
    if (candidate && candidate.endPosition > anchorPos) local = candidate;
  }
  // Likewise a misheard tail must not hide distant evidence just before it. Shortened phrases
  // use only words not yet counted (so earlier evidence can't be counted again), and at most a
  // phrase's worth are cut: each try aligns against the whole script.
  const fresh = finalWords.slice(-(pending ? end - pending.countedTo : Math.min(newWords, added)));
  const findFar = () => {
    let far = bestFar(ctx, phrase, anchorPos);
    for (
      let cut = 1;
      !far && cut <= cfg.phraseWords && fresh.length - cut >= cfg.farMinWords;
      cut++
    ) {
      far = bestFar(ctx, fresh.slice(0, fresh.length - cut).slice(-cfg.phraseWords), anchorPos);
    }
    return far;
  };
  let far: Scored | null = null;
  if (local && pending && local.adjusted < cfg.farThreshold && !agreesWithPending(local)) {
    // A weak local match elsewhere (often just common words) must not cancel a pending jump
    // that this update's distinctive evidence confirms.
    far = findFar();
    if (far && agreesWithPending(far)) local = null;
    else far = null;
  }
  // Words heard before this update that matched nothing (often an ad-lib) don't vouch for a skip.
  local = uniqueIfSkip(ctx, local, anchorPos, Math.min(newWords, added));

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
  far ??= findFar();
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
      pendingJump: { position: far.endPosition, words, countedTo: end, missed: 0 },
      lastDecision: decision('far-pending', ctx, far, phrase),
    };
  }

  return {
    ...state,
    misses,
    status: misses >= cfg.uncertainAfterMisses ? 'uncertain' : state.status,
    // A few unrecognizable updates (e.g. badly misheard segments) don't cancel a pending jump.
    pendingJump:
      pending && pending.missed < cfg.farPendingMaxMisses
        ? { ...pending, missed: pending.missed + 1 }
        : null,
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
  // A guess may skip ahead as a final could, so the display follows a skip before it's final.
  const hi =
    anchorPos + interimWords.length + (state.resyncing ? cfg.resyncForward : cfg.localForward);
  const best = uniqueIfSkip(
    ctx,
    bestLocal(
      ctx,
      phrase,
      anchorPos,
      interimWords.length,
      hi,
      cfg.minTentativeWords,
      cfg.tentativeThreshold,
    ),
    anchorPos,
    interimWords.length,
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
    outline: null,
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
