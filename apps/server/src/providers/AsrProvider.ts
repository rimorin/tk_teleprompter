import type {
  AudioFormat as ClientAudioFormat,
  ErrorCode,
  TranscriptWord,
} from '@teleprompter/shared';

/** Provider-independent transcript result; the session adds sessionId and sequence. */
export type ProviderTranscript = {
  kind: 'interim' | 'final';
  segmentId: string;
  segmentOrder: number;
  text: string;
  words?: TranscriptWord[];
};

export type AudioFormat = ClientAudioFormat & { language: string };

export type AsrCallbacks = {
  onOpen: () => void;
  onTranscript: (t: ProviderTranscript) => void;
  /** Fatal error; the stream is closed afterwards. `code` is safe to show to users. */
  onError: (code: ErrorCode) => void;
  /** Stream ended. `expected` is true after an intentional close(). */
  onClose: (expected: boolean) => void;
};

export interface AsrStream {
  sendAudio(chunk: Buffer): void;
  /** Flush buffered audio so pending results are finalized, then close gracefully. */
  finish(): void;
  /** Close immediately. */
  close(): void;
}

export interface AsrProvider {
  readonly name: string;
  /** False when credentials are missing; sessions then fail fast with asr_not_configured. */
  readonly configured: boolean;
  connect(format: AudioFormat, callbacks: AsrCallbacks): AsrStream;
}
