import WebSocket from 'ws';
import type { ErrorCode } from '@teleprompter/shared';
import {
  droppableAudioBytes,
  type AsrCallbacks,
  type AsrProvider,
  type AsrStream,
  type AudioFormat,
  type ProviderErrorDetail,
} from './AsrProvider';
import { createAssemblyAiNormalizer } from './normalizeAssemblyAi';

type AssemblyAiOptions = {
  apiKey: string | null;
  url: string;
  model: string;
  connectTimeoutMs?: number;
};

/** Audio buffered while the upstream connection opens; older PCM is dropped beyond this. */
const MAX_PENDING_SECONDS = 2;
/**
 * How long to wait for AssemblyAI to end the session after Terminate. It sends the last words,
 * then a Termination message, about a second later (measured).
 */
const FINISH_TIMEOUT_MS = 3_000;
/** As for Deepgram: fail a connection that isn't ready by now, so the client can retry. */
const CONNECT_TIMEOUT_MS = 10_000;
/**
 * Silence (ms) before AssemblyAI checks whether a turn has ended (its default is 400). The word
 * before a pause stays tentative until then, so a shorter check confirms it 0.1–0.5 s sooner
 * (measured). Shorter turns don't matter here: words are confirmed one by one, not per turn.
 */
const MIN_TURN_SILENCE_MS = 160;

/**
 * Map a close code to what the client should do (AssemblyAI refuses sessions after the
 * WebSocket opens, with an Error message and a close code, rather than on the upgrade).
 */
function closeErrorCode(code: number, message: string): ErrorCode {
  // 1008 is also the rate limit on new sessions ("Too many concurrent sessions"): back off.
  if (code === 1008) return /too many/i.test(message) ? 'server_busy' : 'asr_auth_failed';
  if (code === 3009) return 'server_busy'; // streaming rate limit
  // 3006 invalid message, 3007 audio chunks outside 50–1000 ms: a retry would fail the same way.
  if (code === 3006 || code === 3007) return 'asr_error';
  return 'asr_unavailable';
}

export class AssemblyAiProvider implements AsrProvider {
  readonly name = 'assemblyai';
  /**
   * PCM or raw Opus packets, recognized equally fast (measured). Not containerized Opus: it takes
   * Ogg but not the WebM most browsers record, and Ogg was ~0.4 s slower.
   */
  readonly encodings = ['linear16', 'opus_packets'] as const;
  constructor(private readonly opts: AssemblyAiOptions) {}

  get configured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  buildUrl(format: AudioFormat & { encoding: 'linear16' | 'opus_packets' }): string {
    const url = new URL(this.opts.url);
    const params: Record<string, string> = {
      speech_model: this.opts.model,
      // Raw Opus: one packet per message (the session splits the client's frames).
      encoding: format.encoding === 'linear16' ? 'pcm_s16le' : 'opus',
      sample_rate: String(format.sampleRate),
      // Punctuation and casing are unnecessary for matching (it normalizes them away).
      format_turns: 'false',
      min_turn_silence: String(MIN_TURN_SILENCE_MS),
    };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }

  connect(format: AudioFormat, cb: AsrCallbacks): AsrStream {
    // Sessions check `encodings` first, so this only guards against misuse.
    if (format.encoding === 'opus') throw new Error('AssemblyAI is not sent containerized audio');
    return new AssemblyAiStream(
      this.buildUrl(format),
      this.opts,
      droppableAudioBytes(format, MAX_PENDING_SECONDS)!,
      cb,
    );
  }
}

class AssemblyAiStream implements AsrStream {
  private readonly ws: WebSocket;
  private readonly normalize = createAssemblyAiNormalizer();
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private finishTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private closedIntentionally = false;
  private sessionId: string | undefined;
  private lastError: ProviderErrorDetail | undefined;
  private done = false;

  constructor(
    url: string,
    opts: AssemblyAiOptions,
    private readonly maxPendingBytes: number,
    private readonly cb: AsrCallbacks,
  ) {
    this.ws = new WebSocket(url, { headers: { Authorization: opts.apiKey ?? '' } });
    this.connectTimer = setTimeout(
      () => this.fail('asr_unavailable'),
      opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
    );

    // Audio is accepted as soon as the socket opens; the session is ready at Begin.
    this.ws.on('open', () => {
      for (const chunk of this.pending) this.ws.send(chunk);
      this.pending = [];
      this.pendingBytes = 0;
    });

    this.ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
      } catch {
        return;
      }
      const type = (json as { type?: unknown } | null)?.type;
      if (type === 'Begin') {
        if (this.connectTimer) clearTimeout(this.connectTimer);
        const begin = json as { id?: unknown; configuration?: { model?: unknown } };
        this.sessionId = String(begin.id ?? '') || undefined;
        // Unknown query parameters are ignored silently; Begin echoes the model actually applied.
        const model = begin.configuration?.model;
        if (model !== undefined && model !== opts.model) {
          cb.onWarning?.(
            { requested: opts.model, applied: String(model), sessionId: this.sessionId },
            'provider applied a different model',
          );
        }
        cb.onOpen();
      } else if (type === 'Error') {
        const e = json as { error_code?: unknown; error?: unknown };
        this.lastError = { errorCode: Number(e.error_code), error: String(e.error ?? '') };
      } else if (type === 'Termination') {
        // Every result has arrived; no need to wait for the server to close the socket.
        this.close();
      } else {
        for (const t of this.normalize(json)) cb.onTranscript(t);
      }
    });

    this.ws.on('unexpected-response', (_req, res) => {
      res.resume();
      const status = res.statusCode ?? 0;
      this.fail(status === 401 || status === 403 ? 'asr_auth_failed' : 'asr_unavailable', {
        status,
      });
    });

    this.ws.on('error', () => this.fail('asr_unavailable'));

    this.ws.on('close', (code, reason) => {
      if (this.done) return;
      if (!this.closedIntentionally && code !== 1000) {
        this.fail(closeErrorCode(code, `${this.lastError?.error ?? ''} ${reason.toString()}`), {
          closeCode: code,
          reason: reason.toString() || undefined,
          sessionId: this.sessionId,
          ...this.lastError,
        });
        return;
      }
      this.end();
    });
  }

  sendAudio(chunk: Buffer): void {
    if (this.done || this.closedIntentionally || chunk.length === 0) return;
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
    // Terminate flushes the current turn as final, then ends the session (and its billing).
    this.ws.send(JSON.stringify({ type: 'Terminate' }));
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

  private fail(code: ErrorCode, detail?: ProviderErrorDetail) {
    if (this.done) return;
    if (!this.closedIntentionally) this.cb.onError(code, detail);
    this.closedIntentionally = true;
    if (this.ws.readyState !== WebSocket.CLOSED) this.ws.terminate();
    this.end();
  }

  private end() {
    if (this.done) return;
    this.done = true;
    if (this.finishTimer) clearTimeout(this.finishTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.pending = [];
    this.cb.onClose(this.closedIntentionally);
  }
}
