import WebSocket from 'ws';
import type { ErrorCode } from '@teleprompter/shared';
import type { AsrCallbacks, AsrProvider, AsrStream, AudioFormat } from './AsrProvider';
import { normalizeDeepgramMessage } from './normalizeDeepgram';

type DeepgramOptions = {
  apiKey: string | null;
  url: string;
  model: string;
  keepAliveMs?: number;
};

/** Deepgram recommends KeepAlive every 3–5 s when no audio is being sent; it closes after ~10 s. */
const DEFAULT_KEEPALIVE_MS = 4_000;
/** Silence (ms) before Deepgram finalizes a segment. */
const ENDPOINTING_MS = 300;
/** Audio buffered while the upstream connection opens; older audio is dropped beyond this. */
const MAX_PENDING_SECONDS = 2;
/** How long to wait for Deepgram to close after CloseStream before forcing it. */
const FINISH_TIMEOUT_MS = 3_000;

export class DeepgramProvider implements AsrProvider {
  readonly name = 'deepgram';
  constructor(private readonly opts: DeepgramOptions) {}

  get configured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  buildUrl(format: AudioFormat): string {
    const url = new URL(this.opts.url);
    const params: Record<string, string> = {
      model: this.opts.model,
      language: format.language,
      encoding: format.encoding,
      sample_rate: String(format.sampleRate),
      channels: String(format.channels),
      interim_results: 'true',
      endpointing: String(ENDPOINTING_MS),
      // Punctuation and formatting are unnecessary for matching (it normalizes them away).
      punctuate: 'false',
      smart_format: 'false',
    };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }

  connect(format: AudioFormat, cb: AsrCallbacks): AsrStream {
    return new DeepgramStream(this.buildUrl(format), this.opts, format, cb);
  }
}

class DeepgramStream implements AsrStream {
  private readonly ws: WebSocket;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private lastAudioAt = Date.now();
  private keepAlive: NodeJS.Timeout | null = null;
  private finishTimer: NodeJS.Timeout | null = null;
  private closedIntentionally = false;
  private done = false;
  private readonly maxPendingBytes: number;

  constructor(
    url: string,
    private readonly opts: DeepgramOptions,
    format: AudioFormat,
    private readonly cb: AsrCallbacks,
  ) {
    this.maxPendingBytes = format.sampleRate * 2 * MAX_PENDING_SECONDS; // 16-bit mono
    this.ws = new WebSocket(url, { headers: { Authorization: `Token ${opts.apiKey ?? ''}` } });

    this.ws.on('open', () => {
      for (const chunk of this.pending) this.ws.send(chunk);
      this.pending = [];
      this.pendingBytes = 0;
      const interval = this.opts.keepAliveMs ?? DEFAULT_KEEPALIVE_MS;
      this.keepAlive = setInterval(
        () => {
          if (Date.now() - this.lastAudioAt >= interval) this.sendJson({ type: 'KeepAlive' });
        },
        Math.max(250, Math.floor(interval / 2)),
      );
      cb.onOpen();
    });

    this.ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
      } catch {
        return;
      }
      const t = normalizeDeepgramMessage(json);
      if (t) cb.onTranscript(t);
    });

    this.ws.on('unexpected-response', (_req, res) => {
      // Upgrade refused: 401/403 = bad credentials, anything else = unavailable/bad request.
      const code: ErrorCode =
        res.statusCode === 401 || res.statusCode === 403 ? 'asr_auth_failed' : 'asr_unavailable';
      res.resume();
      this.fail(code);
    });

    this.ws.on('error', () => this.fail('asr_unavailable'));

    this.ws.on('close', (code) => {
      if (this.done) return;
      // 1000 after CloseStream is the normal end; other codes mean the provider dropped us.
      if (!this.closedIntentionally && code !== 1000) {
        this.fail(code === 1008 ? 'asr_error' : 'asr_unavailable');
        return;
      }
      this.end();
    });
  }

  sendAudio(chunk: Buffer): void {
    if (this.done || this.closedIntentionally) return;
    this.lastAudioAt = Date.now();
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
      return;
    }
    if (this.ws.readyState !== WebSocket.CONNECTING) return;
    // Bounded buffer while connecting: drop the oldest audio rather than grow without limit.
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    while (this.pendingBytes > this.maxPendingBytes && this.pending.length > 1) {
      this.pendingBytes -= this.pending.shift()!.length;
    }
  }

  finish(): void {
    if (this.done || this.closedIntentionally) return;
    this.closedIntentionally = true;
    if (this.ws.readyState !== WebSocket.OPEN) {
      this.close();
      return;
    }
    // Finalize flushes pending audio into final results; CloseStream then ends the stream and
    // Deepgram closes the socket after sending remaining results.
    this.sendJson({ type: 'Finalize' });
    this.sendJson({ type: 'CloseStream' });
    this.finishTimer = setTimeout(() => this.close(), FINISH_TIMEOUT_MS);
  }

  close(): void {
    if (this.done) return;
    this.closedIntentionally = true;
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.terminate();
    }
    this.end();
  }

  private sendJson(msg: object) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private fail(code: ErrorCode) {
    if (this.done) return;
    if (!this.closedIntentionally) this.cb.onError(code);
    this.closedIntentionally = true;
    if (this.ws.readyState !== WebSocket.CLOSED) this.ws.terminate();
    this.end();
  }

  private end() {
    if (this.done) return;
    this.done = true;
    if (this.keepAlive) clearInterval(this.keepAlive);
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.pending = [];
    this.cb.onClose(this.closedIntentionally);
  }
}
