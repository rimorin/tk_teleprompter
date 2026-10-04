/**
 * All matcher thresholds and window sizes, tuned against the simulated fixtures in
 * matcher/tracker.test.ts. Sizes are in matchable script tokens (words), not characters.
 */
export type MatcherConfig = {
  /** Rolling phrase length: how many recent spoken words are aligned against the script. */
  phraseWords: number;
  /** Minimum aligned spoken words before the confirmed cursor may move locally. */
  minLocalWords: number;
  /** Minimum aligned spoken words before the tentative cursor may move. */
  minTentativeWords: number;
  /** Tokens before the anchor included in the local window, so re-reads can match (never moves back). */
  localBackSlack: number;
  /** Tokens searched beyond the expected position (anchor + new words), including skips. */
  localForward: number;
  /**
   * After a lost connection (a new provider session), the speaker may be further ahead: search
   * this far instead, until speech matches again. Skip-grade evidence is still required.
   */
  resyncForward: number;
  /** Minimum length-normalized alignment score for a local confirmed move. */
  localThreshold: number;
  /** Minimum score for a tentative (interim) move. */
  tentativeThreshold: number;
  /** Forward distance beyond (new words + this slack) counts as a skip and is penalized. */
  distanceFreeSlack: number;
  /** A local move that skips ahead (beyond the free slack) needs this many matched words... */
  localSkipMinWords: number;
  /** ...and at least this score. */
  localSkipThreshold: number;
  /** Score penalty per token of forward distance beyond the free slack. */
  distancePenaltyPerToken: number;
  /** Far (beyond local window) search: minimum aligned words. */
  farMinWords: number;
  /** Far search: minimum score. */
  farThreshold: number;
  /** Far search: minimum summed IDF of matched script words (distinctiveness). */
  farMinDistinctiveness: number;
  /** Far search: best candidate must beat any other candidate by this margin. */
  farUniquenessMargin: number;
  /** Candidates closer than this (tokens) to the best are the same place, not competitors. */
  farCompetitorMinGap: number;
  /**
   * Far search: spoken words that must agree with a distant candidate before jumping, counted
   * across updates so the rule doesn't depend on how the provider splits speech into segments.
   */
  farConfirmWords: number;
  /** Agreeing far candidates must land within this many tokens after the pending one. */
  farAgreementWindow: number;
  /** Unmatched final updates a pending far jump survives before it is dropped. */
  farPendingMaxMisses: number;
  /** Consecutive unmatched final updates before status becomes 'uncertain'. */
  uncertainAfterMisses: number;
  costs: {
    fuzzy: number;
    substitution: number;
    insertion: number;
    fillerInsertion: number;
    deletion: number;
  };
  /** Minimum character similarity (1 - edit distance / length) for a fuzzy word match. */
  fuzzySimilarity: number;
  fillerWords: readonly string[];
  /** Words that carry no distinctiveness (IDF forced to 0). */
  stopWords: readonly string[];
  /**
   * Outline tracking: which bullet the speaker is on while they talk freely around short
   * bullets. A forward-only belief over bullets, updated from bullet keywords heard in finals.
   */
  outline: {
    /** A list item of at most this many words is an outline bullet; a longer one is prose. */
    maxBulletWords: number;
    /** Per final with evidence: probability of moving on to the next bullet. */
    next: number;
    /**
     * Likelihood of a bullet: exp(evidenceWeight * summed IDF of its keywords heard / square
     * root of its summed keyword IDF).
     */
    evidenceWeight: number;
    /** Move to the furthest bullet the speaker has reached with at least this probability. */
    commitProbability: number;
    /** A keyword heard again within this many content words adds no new evidence. */
    repeatWindowWords: number;
    /**
     * Reaching a bullet two or more ahead: of the last `farWindowFinals` finals with evidence,
     * at least `farFinals` must have evidence for it, summing to `farMinEvidence` or more.
     */
    farWindowFinals: number;
    farFinals: number;
    farMinEvidence: number;
    /** Common words that say nothing about which bullet the speaker is on. */
    extraStopWords: readonly string[];
  };
};

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  phraseWords: 8,
  minLocalWords: 3,
  minTentativeWords: 2,
  localBackSlack: 12,
  localForward: 40,
  resyncForward: 80,
  localThreshold: 0.6,
  tentativeThreshold: 0.6,
  distanceFreeSlack: 4,
  localSkipMinWords: 5,
  localSkipThreshold: 0.7,
  distancePenaltyPerToken: 0.006,
  farMinWords: 5,
  farThreshold: 0.8,
  farMinDistinctiveness: 8,
  farUniquenessMargin: 0.15,
  farCompetitorMinGap: 12,
  farConfirmWords: 14,
  farAgreementWindow: 25,
  farPendingMaxMisses: 2,
  uncertainAfterMisses: 2,
  costs: {
    fuzzy: 0.35,
    substitution: 1,
    insertion: 1,
    fillerInsertion: 0.15,
    deletion: 0.8,
  },
  fuzzySimilarity: 0.75,
  fillerWords: ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm', 'like', 'so', 'okay'],
  stopWords: [
    'a',
    'an',
    'the',
    'and',
    'or',
    'but',
    'of',
    'to',
    'in',
    'on',
    'at',
    'for',
    'with',
    'by',
    'from',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'it',
    'its',
    'this',
    'that',
    'these',
    'those',
    'i',
    'you',
    'we',
    'they',
    'he',
    'she',
    'me',
    'us',
    'them',
    'my',
    'our',
    'your',
    'their',
    'as',
    'so',
    'if',
    'not',
    'no',
    'do',
    'does',
    'did',
    'have',
    'has',
    'had',
    'will',
    'would',
    'can',
    'could',
    'just',
    'what',
    'which',
    'who',
    'there',
    'here',
    'all',
    'very',
    'thank',
    'thanks',
  ],
  outline: {
    maxBulletWords: 10,
    next: 0.2,
    evidenceWeight: 1.6,
    commitProbability: 0.6,
    repeatWindowWords: 30,
    farWindowFinals: 3,
    farFinals: 2,
    farMinEvidence: 0.8,
    // prettier-ignore
    extraStopWords: [
      'about', 'over', 'down', 'up', 'out', 'into', 'off', 'more', 'most', 'some', 'any', 'get',
      'got', 'make', 'made', 'go', 'going', 'went', 'take', 'takes', 'took', 'way', 'really',
      'thing', 'things', 'lot', 'well', 'also', 'then', 'than', 'when', 'where', 'how', 'why',
      'now', 'new', 'first', 'next', 'last', 'back', 'see', 'say', 'said', 'know', 'think',
      'want', 'let', 'lets', 'one', 'other', 'every', 'even', 'still', 'too', 'much', 'many',
      'here', 'our', 'were', 'am', 'im', 'it', 'okay', 'right', 'yeah', 'yes', 'great', 'good',
    ],
  },
};
