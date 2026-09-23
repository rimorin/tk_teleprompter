/**
 * All matcher thresholds and window sizes in one place. Values are conservative starting points,
 * tuned against the simulated fixtures in matcher/tracker.test.ts.
 * Search sizes are in matchable script tokens (words), not characters.
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
  /** Tokens after the anchor searched for ordinary progress, including small skips. */
  localForward: number;
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
  /** Far search: consecutive final updates that must agree before jumping. */
  farConfirmations: number;
  /** Agreeing far candidates must land within this many tokens after the pending one. */
  farAgreementWindow: number;
  /** A very strong far match (score and length) may jump without waiting for agreement. */
  farInstantThreshold: number;
  farInstantMinWords: number;
  /** Far search is considered only after this many consecutive unmatched final updates. */
  farSearchAfterMisses: number;
  /** Consecutive unmatched final updates before status becomes 'uncertain'. */
  uncertainAfterMisses: number;
  /** Tentative cursor may run at most this many tokens beyond (confirmed + interim word count). */
  tentativeMaxLead: number;
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
};

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  phraseWords: 8,
  minLocalWords: 3,
  minTentativeWords: 2,
  localBackSlack: 12,
  localForward: 40,
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
  farConfirmations: 2,
  farAgreementWindow: 25,
  farInstantThreshold: 0.95,
  farInstantMinWords: 8,
  farSearchAfterMisses: 1,
  uncertainAfterMisses: 2,
  tentativeMaxLead: 4,
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
};
