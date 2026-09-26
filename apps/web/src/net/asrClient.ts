import {
  AUDIO_FRAME_MS,
  AUDIO_SAMPLE_RATE,
  OPUS_BITS_PER_SECOND,
  OPUS_PACKETS_BITS_PER_SECOND,
  PROTOCOL_VERSION,
  ServerMessage,
  type AudioFormat,
  type ErrorCode,
  type SessionStatus,
  type TranscriptEvent,
} from '@teleprompter/shared';

/*
 * Link health: freshness over completeness. Audio that reaches the recognizer late keeps the
 * highlight behind for several times as long (Deepgram catches up only ~1.25x faster than real
 * time), and a stalled TCP connection releases its whole backlog at once when the signal returns.
 * So a stalled or slow link is replaced by a fresh one rather than waited out; the matcher
 * picks up again from what is said next.
 */

/** Upload older than this (oldest unacknowledged chunk), or server silence this long, is a stall. */
export const STALL_MS = 1_200;
/** Audio held while connecting is sent only if the oldest of it is at most this old. */
export const FRESH_START_MS = 1_500;
/**
 * The socket must open within this time. In a dead zone a new connection can hang for many
 * seconds while the phone retries it; a fresh attempt gets through as soon as the signal is back.
 */
export const OPEN_TIMEOUT_MS = 2_000;
/** Default time for the recognizer to be listening; useLiveSession lengthens it after timeouts. */
export const READY_TIMEOUT_MS = 5_000;
/** How often link health is checked. */
const WATCH_MS = 200;
const PCM_16K: AudioFormat = { encoding: 'linear16', sampleRate: AUDIO_SAMPLE_RATE, channels: 1 };
const STOP_TIMEOUT_MS = 3_000;
/** Recent interim results used for the recognition-delay median. */
const DELAY_SAMPLES = 15;

/** Live timing for the Diagnostics panel. Numbers only: never audio or words. */
export type AsrMetrics = {
  /** Median delay from speaking a word to its interim result (Deepgram's measure); null until word timings arrive. */
  delayMs: number | null;
  /** How long the oldest audio not yet received by the server has been waiting. */
  backlogMs: number;
  /** The audio format being sent. */
  encoding: AudioFormat['encoding'];
};

export type AsrClientError =
  ErrorCode | 'connection_failed' | 'connection_timeout' | 'connection_stalled';

export type AsrClientHandlers = {
  onStatus: (status: SessionStatus) => void;
  onTranscript: (event: TranscriptEvent) => void;
  onError: (code: AsrClientError, message: string) => void;
  /** Socket closed. `intentional` is true after stop()/close(). */
  onClose: (intentional: boolean) => void;
  /**
   * The audio held while connecting became too old to be useful and was dropped: restart the
   * capture so the stream starts fresh (for Opus, with a new container header).
   */
  onStaleStart?: () => void;
};

type ClientOptions = {
  accessCode?: string;
  audio?: AudioFormat;
  /** Id of the session this one replaces after a lost connection. */
  replaces?: string;
  /** Speech provider to use; the server's default when absent. */
  provider?: string;
  readyTimeoutMs?: number;
};

/** WebSocket client for one transcription session (see packages/shared/src/protocol.ts). */
export class AsrClient {
  private ws: WebSocket | null = null;
  private intentional = false;
  private closed = false;
  private readonly options: ClientOptions;
  private readonly audio: AudioFormat;
  /** Server-assigned id, known once the server reports status. */
  private id: string | null = null;
  /** True once the recognizer is listening; audio before that is held. */
  private live = false;
  private held: Array<{ data: ArrayBuffer; at: number }> = [];
  /** Send times of chunks the server hasn't acknowledged yet, oldest first. */
  private unacked: number[] = [];
  private acked = 0;
  /** The server sends acks: link-health checks are on (older servers don't). */
  private acksSeen = false;
  private lastHeardAt = 0;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  /** When this session's audio stream starts (performance.now), for delay timing. */
  private audioStartedAt: number | null = null;
  private delays: number[] = [];

  constructor(
    private readonly url: string,
    private readonly handlers: AsrClientHandlers,
    options: ClientOptions = {},
  ) {
    this.options = options;
    this.audio = options.audio ?? PCM_16K;
  }

  get sessionId(): string | null {
    return this.id;
  }

  get isLive(): boolean {
    return this.live;
  }

  connect(): void {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let opened = false;
    this.openTimer = setTimeout(
      () => this.fail('connection_failed', 'Could not reach the server.'),
      OPEN_TIMEOUT_MS,
    );
    this.readyTimer = setTimeout(
      () => this.fail('connection_timeout', 'The connection took too long.'),
      this.options.readyTimeoutMs ?? READY_TIMEOUT_MS,
    );
    ws.onopen = () => {
      opened = true;
      if (this.openTimer) clearTimeout(this.openTimer);
      this.openTimer = null;
      ws.send(
        JSON.stringify({
          type: 'session.start',
          v: PROTOCOL_VERSION,
          language: 'en',
          audio: this.audio,
          ...(this.options.accessCode ? { accessCode: this.options.accessCode } : {}),
          ...(this.options.replaces ? { replaces: this.options.replaces } : {}),
          ...(this.options.provider ? { provider: this.options.provider } : {}),
        }),
      );
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      this.lastHeardAt = performance.now();
      let msg: ServerMessage;
      try {
        msg = ServerMessage.parse(JSON.parse(e.data));
      } catch {
        return; // Ignore malformed or unknown server messages.
      }
      switch (msg.type) {
        case 'session.status':
          this.id = msg.sessionId ?? this.id;
          if (msg.status === 'listening') this.goLive();
          this.handlers.onStatus(msg.status);
          break;
        case 'session.ack':
          this.acknowledge(msg.chunks);
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
      // fail() ignores errors once the session is closing on purpose.
      if (!opened) this.fail('connection_failed', 'Could not reach the server.');
    };
    ws.onclose = () => {
      this.stopTimers();
      this.held = [];
      if (this.closed) return;
      this.closed = true;
      this.handlers.onClose(this.intentional);
    };
  }

  /**
   * Queue one audio chunk. Before the recognizer is listening, chunks are held (see goLive);
   * after that they are sent at once.
   */
  sendAudio(chunk: ArrayBuffer): void {
    const ws = this.ws;
    if (!ws || this.intentional || ws.readyState > WebSocket.OPEN) return;
    const now = performance.now();
    if (!this.live) {
      this.held.push({ data: chunk, at: now });
      return;
    }
    // The session's audio stream starts with its first chunk, which began one frame earlier.
    this.audioStartedAt ??= now - AUDIO_FRAME_MS;
    ws.send(chunk);
    this.unacked.push(now);
  }

  /** The recognizer is ready: send the held audio if it is still fresh, then watch the link. */
  private goLive() {
    if (this.live) return;
    this.live = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    const held = this.held;
    this.held = [];
    const now = performance.now();
    if (held.length && now - held[0]!.at > FRESH_START_MS) {
      // Too old to help: start the stream over from what is said next.
      this.handlers.onStaleStart?.();
    } else if (held.length) {
      this.audioStartedAt = held[0]!.at - AUDIO_FRAME_MS;
      for (const h of held) {
        this.ws!.send(h.data);
        this.unacked.push(now);
      }
    }
    this.watchTimer = setInterval(() => this.checkLink(), WATCH_MS);
  }

  private acknowledge(chunks: number) {
    this.acksSeen = true;
    const newly = Math.min(this.unacked.length, Math.max(0, chunks - this.acked));
    this.unacked.splice(0, newly);
    this.acked += newly;
  }

  private uploadLag(now: number): number {
    return this.unacked.length ? now - this.unacked[0]! : 0;
  }

  private checkLink() {
    if (!this.acksSeen) return; // An older server without acks: nothing to judge by.
    const now = performance.now();
    if (now - this.lastHeardAt > STALL_MS || this.uploadLag(now) > STALL_MS) {
      this.fail('connection_stalled', 'The connection stalled.');
    }
  }

  private fail(code: AsrClientError, message: string) {
    if (this.intentional || this.closed) return;
    this.handlers.onError(code, message);
    this.close();
  }

  metrics(): AsrMetrics {
    const sorted = [...this.delays].sort((a, b) => a - b);
    const now = performance.now();
    const bytesPerSecond =
      this.audio.encoding === 'linear16'
        ? this.audio.sampleRate * 2
        : (this.audio.encoding === 'opus' ? OPUS_BITS_PER_SECOND : OPUS_PACKETS_BITS_PER_SECOND) /
          8;
    return {
      delayMs: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null,
      backlogMs: this.acksSeen
        ? this.uploadLag(now)
        : ((this.ws?.bufferedAmount ?? 0) / bytesPerSecond) * 1000,
      encoding: this.audio.encoding,
    };
  }

  private recordDelay(lastWordEndMs: number) {
    if (this.audioStartedAt === null) return;
    const delay = performance.now() - (this.audioStartedAt + lastWordEndMs);
    this.delays.push(Math.max(0, delay));
    if (this.delays.length > DELAY_SAMPLES) this.delays.shift();
  }

  private stopTimers() {
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.openTimer = null;
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.readyTimer = null;
    this.watchTimer = null;
  }

  /** Ask the server to finalize and end the session; resolves once the socket closes. */
  stop(): Promise<void> {
    this.intentional = true;
    this.stopTimers();
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
    this.stopTimers();
    this.ws?.close();
  }
}
