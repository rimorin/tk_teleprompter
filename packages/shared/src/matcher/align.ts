import type { MatchContext } from './context';

export type AlignmentCandidate = {
  /** Matchable position of the last script word aligned to the phrase. */
  endPosition: number;
  /** Length-normalized score in (-inf, 1]; 1 means every spoken word matched exactly. */
  score: number;
  /** Summed IDF of script words matched (exactly or fuzzily). */
  distinctiveness: number;
  /** Number of spoken words matched to script words. */
  matchedWords: number;
};

const enum Op {
  None,
  Sub,
  Ins,
  Del,
  Form,
}

function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

function isFuzzy(ctx: MatchContext, a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  if (la < 4 || lb < 4) return false;
  const max = Math.max(la, lb);
  if (Math.abs(la - lb) > max * (1 - ctx.config.fuzzySimilarity)) {
    // Allow stem-like variants: "customer" / "customers", "decide" / "deciding".
    return commonPrefix(a, b) >= 5 && Math.abs(la - lb) <= 3;
  }
  const cacheKey = a < b ? `${a}|${b}` : `${b}|${a}`;
  let hit = ctx.fuzzyCache.get(cacheKey);
  if (hit === undefined) {
    hit =
      1 - levenshtein(a, b) / max >= ctx.config.fuzzySimilarity ||
      (commonPrefix(a, b) >= 5 && Math.abs(la - lb) <= 3);
    if (ctx.fuzzyCache.size > 50_000) ctx.fuzzyCache.clear();
    ctx.fuzzyCache.set(cacheKey, hit);
  }
  return hit;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Returns [cost, isMatch] for aligning spoken word `w` to script position `p`. */
function substitution(ctx: MatchContext, w: string, p: number): [number, boolean] {
  const key = ctx.keys[p]!;
  if (w === key || ctx.altKeys[p]?.includes(w)) return [0, true];
  if (isFuzzy(ctx, w, key)) return [ctx.config.costs.fuzzy, true];
  return [ctx.config.costs.substitution, false];
}

/**
 * Semi-global alignment of the whole phrase against script positions [lo, hi]: every spoken word
 * is consumed, but the phrase may start and end anywhere in the window. Operations: match or
 * substitution, insertion (spoken word not in the script; fillers are cheap), deletion (script
 * word not spoken), and a multi-word spoken form of one token (numbers). Returns one candidate
 * per end position whose path ends on a script word.
 */
export function alignPhrase(
  ctx: MatchContext,
  phrase: readonly string[],
  lo: number,
  hi: number,
): AlignmentCandidate[] {
  const m = phrase.length;
  lo = Math.max(0, lo);
  hi = Math.min(ctx.keys.length - 1, hi);
  const w = hi - lo + 1;
  if (m === 0 || w <= 0) return [];
  const { costs } = ctx.config;
  const cols = w + 1;
  const cost = new Float64Array((m + 1) * cols);
  const op = new Uint8Array((m + 1) * cols);
  const back = new Uint8Array((m + 1) * cols); // form length for Op.Form
  const matched = new Uint8Array((m + 1) * cols); // whether a Sub op was a match

  const insCost = (word: string) =>
    ctx.fillers.has(word) ? costs.fillerInsertion : costs.insertion;

  for (let i = 1; i <= m; i++) {
    cost[i * cols] = cost[(i - 1) * cols]! + insCost(phrase[i - 1]!);
    op[i * cols] = Op.Ins;
  }
  for (let i = 1; i <= m; i++) {
    const word = phrase[i - 1]!;
    const ins = insCost(word);
    for (let j = 1; j <= w; j++) {
      const p = lo + j - 1;
      const idx = i * cols + j;
      const [subCost, isMatch] = substitution(ctx, word, p);
      let best = cost[(i - 1) * cols + j - 1]! + subCost;
      let bestOp = Op.Sub;
      const insTotal = cost[(i - 1) * cols + j]! + ins;
      if (insTotal < best) {
        best = insTotal;
        bestOp = Op.Ins;
      }
      const delTotal = cost[i * cols + j - 1]! + costs.deletion;
      if (delTotal < best) {
        best = delTotal;
        bestOp = Op.Del;
      }
      let formLen = 0;
      const forms = ctx.multiForms[p];
      if (forms) {
        for (const form of forms) {
          const k = form.length;
          if (k > i) continue;
          let ok = true;
          for (let t = 0; t < k && ok; t++) ok = phrase[i - k + t] === form[t];
          if (ok && cost[(i - k) * cols + j - 1]! < best) {
            best = cost[(i - k) * cols + j - 1]!;
            bestOp = Op.Form;
            formLen = k;
          }
        }
      }
      cost[idx] = best;
      op[idx] = bestOp;
      back[idx] = formLen;
      matched[idx] = bestOp === Op.Sub && isMatch ? 1 : 0;
    }
  }

  const candidates: AlignmentCandidate[] = [];
  for (let j = 1; j <= w; j++) {
    const idx = m * cols + j;
    if (!endsOnScriptWord(op, m, j, cols)) continue;
    const { distinctiveness, matchedWords } = backtrace(ctx, op, back, matched, m, j, cols, lo);
    candidates.push({
      endPosition: lo + j - 1,
      score: 1 - cost[idx]! / m,
      distinctiveness,
      matchedWords,
    });
  }
  return candidates;
}

/**
 * True if the path ending at (m, j) aligned script column j to a spoken word. Trailing
 * insertions are skipped; a path that reached column j by deleting it, or never left the free
 * start row, ends on an earlier (or no) script word and is dominated by that candidate.
 */
function endsOnScriptWord(op: Uint8Array, m: number, j: number, cols: number): boolean {
  let i = m;
  while (i > 0 && op[i * cols + j] === Op.Ins) i--;
  if (i === 0) return false;
  const last = op[i * cols + j];
  return last === Op.Sub || last === Op.Form;
}

function backtrace(
  ctx: MatchContext,
  op: Uint8Array,
  back: Uint8Array,
  matched: Uint8Array,
  m: number,
  j: number,
  cols: number,
  lo: number,
) {
  let i = m;
  let distinctiveness = 0;
  let matchedWords = 0;
  while (i > 0 && j > 0) {
    const idx = i * cols + j;
    switch (op[idx]) {
      case Op.Sub:
        if (matched[idx]) {
          distinctiveness += ctx.idf[lo + j - 1]!;
          matchedWords++;
        }
        i--;
        j--;
        break;
      case Op.Form:
        distinctiveness += ctx.idf[lo + j - 1]!;
        matchedWords += back[idx]!;
        i -= back[idx]!;
        j--;
        break;
      case Op.Ins:
        i--;
        break;
      case Op.Del:
        j--;
        break;
      default:
        i = 0;
    }
  }
  return { distinctiveness, matchedWords };
}
