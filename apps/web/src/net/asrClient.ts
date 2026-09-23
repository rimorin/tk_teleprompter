import {
  AUDIO_SAMPLE_RATE,
  PROTOCOL_VERSION,
  ServerMessage,
  type ErrorCode,
  type SessionStatus,
  type TranscriptEvent,
} from '@teleprompter/shared';

/** Stop sending (drop audio) when this much is queued in the socket: ~2 s of 16 kHz PCM16. */
const MAX_BUFFERED_BYTES = 64_000;
const STOP_TIMEOUT_MS = 3_000;

export type AsrClientHandlers = {
  onStatus: (status: SessionStatus) => void;
  onTranscript: (event: TranscriptEvent) => void;
  onError: (code: ErrorCode | 'connection_failed', message: string) => void;
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

  constructor(
    private readonly url: string,
    private readonly handlers: AsrClientHandlers,
    options: { accessCode?: string; maxBufferedBytes?: number } = {},
  ) {
    this.accessCode = options.accessCode;
    this.maxBufferedBytes = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
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
          audio: { encoding: 'linear16', sampleRate: AUDIO_SAMPLE_RATE, channels: 1 },
          ...(this.accessCode ? { accessCode: this.accessCode } : {}),
        }),
      );
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
        this.handlers.onError('connection_failed', 'Could not reach the tracking server.');
      }
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.closed = true;
      this.handlers.onClose(this.intentional);
    };
  }

  /** Send one audio frame, or drop it if the network is backed up. Returns false if dropped. */
  sendAudio(pcm: ArrayBuffer): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > this.maxBufferedBytes) {
      return false;
    }
    ws.send(pcm);
    return true;
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
