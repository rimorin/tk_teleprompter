import {
  AUDIO_FRAME_MS,
  AUDIO_SAMPLE_RATE,
  OPUS_BITS_PER_SECOND,
  PROTOCOL_VERSION,
  ServerMessage,
  type AudioFormat,
  type ErrorCode,
  type SessionStatus,
  type TranscriptEvent,
} from '@teleprompter/shared';

/** PCM: drop audio when this much is queued in the socket, ~2 s of 16 kHz PCM16. */
const MAX_BUFFERED_BYTES = 64_000;
/**
 * Opus can't be dropped without corrupting the stream, so a backlog of ~2 s ends the session
 * instead. While connecting, up to ~16 s is held.
 */
const MAX_BUFFERED_OPUS_BYTES = (OPUS_BITS_PER_SECOND / 8) * 2;
const MAX_PENDING_OPUS_BYTES = 64_000;
const PCM_16K: AudioFormat = { encoding: 'linear16', sampleRate: AUDIO_SAMPLE_RATE, channels: 1 };
const STOP_TIMEOUT_MS = 3_000;
/** Recent interim results used for the recognition-delay median. */
const DELAY_SAMPLES = 15;

/** Live timing for the Diagnostics panel. Numbers only: never audio or words. */
export type AsrMetrics = {
  /**
   * How long after a word was spoken it came back (median of recent interim results), from the
   * audio sent so far vs. where the latest result ends (Deepgram's latency measure). Null
   * until a result with word timings arrives.
   */
  delayMs: number | null;
  /** Seconds of audio waiting to leave this device (socket queue plus audio held while connecting). */
  backlogMs: number;
};

export type AsrClientHandlers = {
  onStatus: (status: SessionStatus) => void;
  onTranscript: (event: TranscriptEvent) => void;
  onError: (code: ErrorCode | 'connection_failed' | 'network_slow', message: string) => void;
  /** Socket closed. `intentional` is true after stop()/close(). */
  onClose: (intentional: boolean) => void;
};

/** WebSocket client for one transcription session (see packages/shared/src/protocol.ts). */
export class AsrClient {
  private ws: WebSocket | null = null;
  private intentional = false;
  private closed = false;
  private readonly accessCode: string | undefined;
  private readonly maxBufferedBytes: number;
  private readonly audio: AudioFormat;
  /** Compressed streams must arrive whole: never drop a chunk. */
  private readonly lossless: boolean;
  /** Audio captured while the socket is still connecting, sent right after session.start. */
  private pending: ArrayBuffer[] = [];
  private pendingBytes = 0;
  /** When the first audio of this session was captured (performance.now), for delay timing. */
  private audioStartedAt: number | null = null;
  private delays: number[] = [];

  constructor(
    private readonly url: string,
    private readonly handlers: AsrClientHandlers,
    options: { accessCode?: string; audio?: AudioFormat; maxBufferedBytes?: number } = {},
  ) {
    this.accessCode = options.accessCode;
    this.audio = options.audio ?? PCM_16K;
    this.lossless = this.audio.encoding !== 'linear16';
    this.maxBufferedBytes =
      options.maxBufferedBytes ?? (this.lossless ? MAX_BUFFERED_OPUS_BYTES : MAX_BUFFERED_BYTES);
  }

  connect(): void {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      ws.send(
        JSON.stringify({
          type: 'session.start',
          v: PROTOCOL_VERSION,
          language: 'en',
          audio: this.audio,
          ...(this.accessCode ? { accessCode: this.accessCode } : {}),
        }),
      );
      for (const pcm of this.pending) ws.send(pcm);
      this.pending = [];
      this.pendingBytes = 0;
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = ServerMessage.parse(JSON.parse(e.data));
      } catch {
        return; // Ignore malformed or unknown server messages.
      }
      switch (msg.type) {
        case 'session.status':
          this.handlers.onStatus(msg.status);
          break;
        case 'session.error':
          this.handlers.onError(msg.code, msg.message);
          break;
        case 'transcript.interim':
        case 'transcript.final': {
          const { type, ...fields } = msg;
          // Deepgram advises timing interim results only (finals may end early).
          const lastWordEnd = msg.words?.at(-1)?.endMs;
          if (type === 'transcript.interim' && lastWordEnd !== undefined) {
            this.recordDelay(lastWordEnd);
          }
          this.handlers.onTranscript({
            ...fields,
            kind: type === 'transcript.final' ? 'final' : 'interim',
          });
          break;
        }
      }
    };
    ws.onerror = () => {
      if (!opened && !this.intentional) {
        this.handlers.onError('connection_failed', 'Could not reach the server.');
      }
    };
    ws.onclose = () => {
      this.pending = [];
      this.pendingBytes = 0;
      if (this.closed) return;
      this.closed = true;
      this.handlers.onClose(this.intentional);
    };
  }

  /**
   * Send one audio chunk. While connecting, chunks are held so the first words aren't lost (PCM
   * drops the oldest beyond the limit). Returns false if dropped: socket gone or network backed
   * up. A backed-up Opus stream can't drop audio, so it ends the session instead.
   */
  sendAudio(chunk: ArrayBuffer): boolean {
    const ws = this.ws;
    // The session's audio clock starts with its first chunk, which began one frame earlier.
    this.audioStartedAt ??= performance.now() - AUDIO_FRAME_MS;
    if (ws && ws.readyState === WebSocket.CONNECTING && !this.intentional) {
      this.pending.push(chunk);
      this.pendingBytes += chunk.byteLength;
      if (this.lossless) {
        if (this.pendingBytes > MAX_PENDING_OPUS_BYTES) this.failSlow();
        return !this.intentional;
      }
      while (this.pendingBytes > this.maxBufferedBytes && this.pending.length > 1) {
        this.pendingBytes -= this.pending.shift()!.byteLength;
      }
      return true;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (ws.bufferedAmount > this.maxBufferedBytes) {
      if (this.lossless) this.failSlow();
      return false;
    }
    ws.send(chunk);
    return true;
  }

  private failSlow() {
    this.handlers.onError(
      'network_slow',
      'The network is too slow for voice following right now. The buttons still work.',
    );
    this.close();
  }

  metrics(): AsrMetrics {
    const sorted = [...this.delays].sort((a, b) => a - b);
    const queued = (this.ws?.bufferedAmount ?? 0) + this.pendingBytes;
    const bytesPerSecond =
      this.audio.encoding === 'linear16' ? this.audio.sampleRate * 2 : OPUS_BITS_PER_SECOND / 8;
    return {
      delayMs: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null,
      backlogMs: (queued / bytesPerSecond) * 1000,
    };
  }

  private recordDelay(lastWordEndMs: number) {
    if (this.audioStartedAt === null) return;
    const delay = performance.now() - (this.audioStartedAt + lastWordEndMs);
    this.delays.push(Math.max(0, delay));
    if (this.delays.length > DELAY_SAMPLES) this.delays.shift();
  }

  /** Ask the server to finalize and end the session; resolves once the socket closes. */
  stop(): Promise<void> {
    this.intentional = true;
    const ws = this.ws;
    if (!ws || ws.readyState >= WebSocket.CLOSING) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        ws.close();
        resolve();
      }, STOP_TIMEOUT_MS);
      ws.addEventListener('close', () => {
        clearTimeout(timer);
        resolve();
      });
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'session.stop' }));
      else ws.close();
    });
  }

  close(): void {
    this.intentional = true;
    this.ws?.close();
  }
}
