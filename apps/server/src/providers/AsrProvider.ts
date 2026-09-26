import {
  OPUS_PACKETS_BITS_PER_SECOND,
  type AudioFormat as ClientAudioFormat,
  type ErrorCode,
  type TranscriptWord,
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

/**
 * Bytes in `seconds` of audio that can be dropped while a provider connects: PCM, or Opus
 * packets (at twice their nominal bitrate, since packet sizes vary). Null for containerized
 * audio, which can't be dropped without corrupting the stream.
 */
export function droppableAudioBytes(format: ClientAudioFormat, seconds: number): number | null {
  if (format.encoding === 'linear16') return format.sampleRate * 2 * seconds; // 16-bit mono
  if (format.encoding === 'opus_packets') return (OPUS_PACKETS_BITS_PER_SECOND / 8) * 2 * seconds;
  return null;
}

export type ProviderErrorDetail = Record<string, string | number | undefined>;

export type AsrCallbacks = {
  onOpen: () => void;
  onTranscript: (t: ProviderTranscript) => void;
  /**
   * Fatal error; the stream is closed afterwards. `code` is safe to show to users; `detail` is
   * for server logs (status codes, provider request ids; never audio, text or credentials).
   */
  onError: (code: ErrorCode, detail?: ProviderErrorDetail) => void;
  /** Something worth a server log line that doesn't end the stream (same rules as `detail`). */
  onWarning?: (detail: ProviderErrorDetail, message: string) => void;
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
  /** Audio encodings the provider accepts (advertised on /health so clients pick one). */
  readonly encodings: readonly ClientAudioFormat['encoding'][];
  connect(format: AudioFormat, callbacks: AsrCallbacks): AsrStream;
}
