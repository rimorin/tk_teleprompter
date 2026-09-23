/** One display token of the reference script. Offsets index into `ParsedScript.source`. */
export type ScriptToken = {
  id: number;
  paragraphId: number;
  displayText: string;
  /** Lowercased, edge-punctuation-stripped form used for matching. May be '' for pure punctuation. */
  normalized: string;
  /** Alternative spoken renderings (space-separated words), e.g. "20" -> ["twenty"]. */
  spokenForms?: string[];
  startOffset: number;
  endOffset: number;
};

export type Paragraph = {
  id: number;
  startOffset: number;
  endOffset: number;
  firstTokenId: number;
  lastTokenId: number;
};

export type ParsedScript = {
  /** Script text with line endings normalized to \n and any BOM removed. Otherwise unchanged. */
  source: string;
  paragraphs: Paragraph[];
  tokens: ScriptToken[];
};

export type TranscriptWord = {
  text: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
};

/**
 * Provider-independent transcript observation.
 * - `interim` replaces any previous interim hypothesis (it is not a delta).
 * - `final` commits a segment; a repeated `segmentId` is ignored.
 * - `segmentOrder` is the segment's monotonic position in the audio stream (e.g. its start time in
 *   ms); it orders finals and ties an interim to the final that will replace it.
 */
export type TranscriptEvent = {
  sessionId: string;
  segmentId: string;
  segmentOrder: number;
  kind: 'interim' | 'final';
  text: string;
  sequence: number;
  words?: TranscriptWord[];
};

export type TrackingStatus = 'idle' | 'tracking' | 'paused' | 'uncertain' | 'disconnected';
