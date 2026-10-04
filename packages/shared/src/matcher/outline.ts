import type { OutlineBullet } from '../outline';
import type { ParsedScript } from '../types';
import { DEFAULT_MATCHER_CONFIG, type MatcherConfig } from './config';

/**
 * Outline tracking: which bullet the speaker is on while they talk around short bullets in
 * their own words. Bullet keywords heard in finals are sparse but reliable evidence, so:
 *
 * - A forward-only belief over bullets (an HMM filter, as in score following) pools the
 *   evidence across finals to move on to the next bullet.
 * - Speech that doesn't tell nearby bullets apart (a tangent, or words every bullet shares)
 *   leaves the belief alone: no keyword is no evidence of moving on.
 * - Evidence is scaled by the square root of the bullet's keyword weight, so one word is strong
 *   evidence for a one-word bullet ("Questions") but weak for a long one.
 * - The bullet moves forward once the speaker has probably reached it or gone beyond, never
 *   back.
 * - Further ahead (a skip, or catching up after paraphrased bullets), a bullet is reacquired
 *   when several recent finals have evidence for it, outweighing every bullet in between: a
 *   later point mentioned in passing is not a skip.
 */

export type OutlineContext = {
  config: MatcherConfig;
  bullets: OutlineBullet[];
  /** Per bullet, per keyword: its stemmed forms (e.g. "12" -> twelve). */
  keywords: string[][][];
  /** Per bullet, per keyword: IDF across bullets (0 for a word every bullet has). */
  idf: number[][];
  /** Per bullet: square root of its summed keyword IDF (at least 1), which evidence is divided by. */
  scale: number[];
  stopWords: Set<string>;
};

export type OutlineState = {
  /** Index of the bullet the speaker is on (confirmed). */
  bullet: number;
  /** Probability the speaker is on each bullet. */
  belief: number[];
  /** Recent content-word stems, so a keyword repeated within the window counts once. */
  recent: string[];
  /** Per-bullet evidence of the last few finals that had any, oldest first. */
  history: number[][];
};

/** Crude suffix stemming: "customers" / "customer", "piloted" / "pilot", "days" / "day". */
function stem(word: string): string {
  const w = word.replace(/'/g, '');
  if (w.length <= 4) return w;
  return w.replace(/(ings?|ed|es|s|ly)$/, '').replace(/(.)\1$/, '$1') || w;
}

function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p >= 5 && Math.abs(a.length - b.length) <= 3; // "automate" / "automated"
}

export function createOutlineContext(
  script: ParsedScript,
  bullets: OutlineBullet[],
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
): OutlineContext {
  const stopWords = new Set([
    ...config.stopWords,
    ...config.fillerWords,
    ...config.outline.extraStopWords,
  ]);
  const keywords = bullets.map((b) => {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (let id = b.firstTokenId; id <= b.lastTokenId; id++) {
      const token = script.tokens[id]!;
      if (!token.normalized || stopWords.has(token.normalized)) continue;
      const single = (token.spokenForms ?? []).filter((f) => !f.includes(' '));
      const forms = [...new Set([token.normalized, ...single].map(stem))];
      if (seen.has(forms[0]!)) continue;
      seen.add(forms[0]!);
      out.push(forms);
    }
    return out;
  });
  const df = new Map<string, number>();
  for (const ks of keywords) for (const k of ks) df.set(k[0]!, (df.get(k[0]!) ?? 0) + 1);
  const n = bullets.length;
  const idf = keywords.map((ks) =>
    ks.map((k) => (df.get(k[0]!) === n ? 0 : Math.log(1 + n / df.get(k[0]!)!))),
  );
  const scale = idf.map((ws) => Math.max(1, Math.sqrt(ws.reduce((a, b) => a + b, 0))));
  return { config, bullets, keywords, idf, scale, stopWords };
}

export function initialOutlineState(ctx: OutlineContext, bullet = 0): OutlineState {
  return {
    bullet,
    belief: ctx.bullets.map((_, i) => (i === bullet ? 1 : 0)),
    recent: [],
    history: [],
  };
}

/** Manual reposition: the speaker is on `bullet`; earlier evidence is dropped. */
export const repositionOutline = initialOutlineState;

function contentStems(ctx: OutlineContext, words: readonly string[]): string[] {
  return words.filter((w) => w && !ctx.stopWords.has(w)).map(stem);
}

/** Summed IDF of bullet `k`'s keywords in `heard` that weren't already in `recent`. */
function evidence(ctx: OutlineContext, k: number, heard: string[], recent: string[]): number {
  let sum = 0;
  ctx.keywords[k]!.forEach((forms, i) => {
    const has = (words: string[]) => words.some((w) => forms.some((f) => sameStem(w, f)));
    if (has(heard) && !has(recent)) sum += ctx.idf[k]![i]!;
  });
  return sum / ctx.scale[k]!;
}

/** Filter step: move belief on to the next bullet only, then weigh in this final's evidence. */
function filter(ctx: OutlineContext, state: OutlineState, ev: number[]): number[] {
  const cfg = ctx.config.outline;
  const n = ev.length;
  const prior = new Array<number>(n).fill(0);
  for (let i = state.bullet; i < n; i++) {
    const mass = state.belief[i]!;
    if (i + 1 < n) {
      prior[i]! += mass * (1 - cfg.next);
      prior[i + 1]! += mass * cfg.next;
    } else prior[i]! += mass;
  }
  const post = prior.map((p, k) => p * Math.exp(cfg.evidenceWeight * ev[k]!));
  const z = post.reduce((a, b) => a + b, 0);
  return post.map((p) => p / z);
}

/** The furthest bullet the speaker has reached (or gone beyond) with enough probability. */
function reachedBullet(ctx: OutlineContext, from: number, belief: number[]): number {
  let tail = 0;
  for (let k = belief.length - 1; k > from; k--) {
    tail += belief[k]!;
    if (tail >= ctx.config.outline.commitProbability) return k;
  }
  return from;
}

/**
 * A bullet two or more ahead with evidence in enough recent finals, outweighing every bullet
 * from the current one up to it, or null.
 */
function reacquired(ctx: OutlineContext, from: number, history: number[][]): number | null {
  const cfg = ctx.config.outline;
  const pooled = history[0]!.map((_, k) => history.reduce((a, ev) => a + ev[k]!, 0));
  let best: number | null = null;
  let between = Math.max(...pooled.slice(from, from + 2));
  for (let k = from + 2; k < pooled.length; k++) {
    const finals = history.filter((ev) => ev[k]! > 0).length;
    if (
      finals >= cfg.farFinals &&
      pooled[k]! >= cfg.farMinEvidence &&
      pooled[k]! > between &&
      (best === null || pooled[k]! > pooled[best]!)
    ) {
      best = k;
    }
    between = Math.max(between, pooled[k]!);
  }
  return best;
}

/** Fold the words of one final into the state. */
export function updateOutline(
  ctx: OutlineContext,
  state: OutlineState,
  words: readonly string[],
): OutlineState {
  const cfg = ctx.config.outline;
  const heard = contentStems(ctx, words);
  const recent = [...state.recent, ...heard].slice(-cfg.repeatWindowWords);
  const ev = ctx.bullets.map((_, k) => evidence(ctx, k, heard, state.recent));
  const ahead = ev.slice(state.bullet);
  // Nothing that tells the bullets ahead apart (a tangent): no evidence of moving on.
  if (Math.max(...ahead) === Math.min(...ahead)) return { ...state, recent };

  const history = [...state.history, ev].slice(-cfg.farWindowFinals);
  const far = reacquired(ctx, state.bullet, history);
  if (far !== null) return { ...initialOutlineState(ctx, far), recent, history: [] };
  const belief = filter(ctx, state, ev);
  return { bullet: reachedBullet(ctx, state.bullet, belief), belief, recent, history };
}

/**
 * The bullet an interim hypothesis suggests the speaker has moved on to, or null. Display only:
 * it never changes the state.
 */
export function tentativeOutlineBullet(
  ctx: OutlineContext,
  state: OutlineState,
  interimWords: readonly string[],
): number | null {
  const next = updateOutline(ctx, state, interimWords).bullet;
  return next > state.bullet ? next : null;
}
