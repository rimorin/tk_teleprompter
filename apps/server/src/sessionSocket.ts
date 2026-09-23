import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import {
  ClientMessage,
  ERROR_MESSAGES,
  MAX_AUDIO_FRAME_BYTES,
  PROTOCOL_VERSION,
  type ErrorCode,
  type ServerMessage,
  type SessionStatus,
} from '@teleprompter/shared';
import type { AccessControl } from './accessControl';
import { isAllowedOrigin } from './origin';
import type { AsrProvider, AsrStream } from './providers/AsrProvider';

/** Largest JSON control message accepted. */
const MAX_CONTROL_BYTES = 4_096;
/** A session must send session.start within this time. */
const START_TIMEOUT_MS = 10_000;

type SessionRouteOptions = {
  provider: AsrProvider;
  allowedOrigins: string[];
  access: AccessControl;
  /** Open sessions, so a shutdown can finalize them. */
  sessions: Set<Session>;
};

/**
 * One WebSocket = one transcription session. Protocol:
 *   client: session.start → binary audio frames … → session.stop
 *   server: session.status / transcript.interim / transcript.final / session.error
 * Audio and transcript content are never logged.
 */
export function registerSessionRoute(app: FastifyInstance, opts: SessionRouteOptions) {
  app.get(
    '/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const origin = request.headers.origin;
        // Browsers always send Origin on WebSocket upgrades; reject other sites' pages.
        if (!isAllowedOrigin(origin, request.headers.host, opts.allowedOrigins)) {
          request.log.warn({ origin: origin ?? null }, 'rejected websocket origin');
          await reply.code(403).send({ error: 'forbidden origin' });
        }
      },
    },
    (socket, request) => {
      const session = new Session(socket, opts.provider, opts.access, request.ip, request.log, () =>
        opts.sessions.delete(session),
      );
      opts.sessions.add(session);
    },
  );
}

export class Session {
  private readonly id = randomUUID();
  private stream: AsrStream | null = null;
  private state: 'awaiting_start' | 'active' | 'stopping' | 'closed' = 'awaiting_start';
  private sequence = 0;
  private admitted = false;
  private readonly startTimer: NodeJS.Timeout;
  private lifetimeTimer: NodeJS.Timeout | null = null;
  private readonly log: FastifyBaseLogger;

  constructor(
    private readonly socket: WebSocket,
    private readonly provider: AsrProvider,
    private readonly access: AccessControl,
    private readonly ip: string,
    parentLog: FastifyBaseLogger,
    private readonly onClosed: () => void,
  ) {
    this.log = parentLog.child({ sessionId: this.id });
    this.log.info('session opened');
    this.startTimer = setTimeout(() => {
      if (this.state === 'awaiting_start') this.fail('bad_message');
    }, START_TIMEOUT_MS);
    socket.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    socket.on('close', () => this.cleanup('client closed'));
    socket.on('error', () => this.cleanup('client socket error'));
  }

  private onMessage(data: RawData, isBinary: boolean) {
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    if (isBinary) {
      if (buf.length > MAX_AUDIO_FRAME_BYTES || buf.length % 2 !== 0)
        return this.fail('bad_message');
      if (this.state === 'active') this.stream?.sendAudio(buf);
      return;
    }
    if (buf.length > MAX_CONTROL_BYTES) return this.fail('bad_message');
    let parsed: ReturnType<typeof ClientMessage.safeParse>;
    try {
      parsed = ClientMessage.safeParse(JSON.parse(buf.toString('utf8')));
    } catch {
      return this.fail('bad_message');
    }
    if (!parsed.success) return this.fail('bad_message');
    const msg = parsed.data;

    if (msg.type === 'session.start') {
      if (this.state !== 'awaiting_start') return this.fail('bad_message');
      clearTimeout(this.startTimer);
      if (msg.v !== PROTOCOL_VERSION) return this.fail('unsupported_version');
      if (!this.provider.configured) return this.fail('asr_not_configured');
      const denied = this.access.admit(this.ip, msg.accessCode);
      if (denied) return this.fail(denied);
      this.admitted = true;
      // Bound the cost of any one session (e.g. a forgotten open tab).
      this.lifetimeTimer = setTimeout(
        () => this.end('session_time_limit'),
        this.access.limits.maxSessionMs,
      );
      this.state = 'active';
      this.status('connecting');
      this.stream = this.provider.connect(
        { ...msg.audio, language: msg.language },
        {
          onOpen: () => this.status('listening'),
          onTranscript: (t) =>
            this.send({
              type: t.kind === 'final' ? 'transcript.final' : 'transcript.interim',
              sessionId: this.id,
              segmentId: t.segmentId,
              segmentOrder: t.segmentOrder,
              sequence: this.sequence++,
              text: t.text,
              ...(t.words ? { words: t.words } : {}),
            }),
          onError: (code) => this.fail(code),
          onClose: (expected) => {
            this.stream = null;
            if (this.state === 'closed') return;
            if (expected && this.state === 'stopping') {
              this.status('stopped');
              this.closeSocket(1000);
            } else {
              this.log.warn('provider stream ended unexpectedly');
              this.status('disconnected');
              this.closeSocket(1011);
            }
          },
        },
      );
      this.log.info(
        { provider: this.provider.name, sampleRate: msg.audio.sampleRate },
        'session started',
      );
      return;
    }

    this.finishOrClose(1000); // session.stop
  }

  /**
   * End gracefully with a reason the client can show: flush the provider so pending speech is
   * finalized and delivered, then close. Used for the time limit and server shutdown.
   */
  end(reason: ErrorCode): Promise<void> {
    if (this.state === 'closed') return Promise.resolve();
    this.log.info({ reason }, 'ending session');
    const closed = new Promise<void>((resolve) => this.socket.once('close', () => resolve()));
    this.send({ type: 'session.error', code: reason, message: ERROR_MESSAGES[reason] });
    this.finishOrClose(reason === 'server_restarting' ? 1012 : 1000);
    return closed;
  }

  /** Flush the provider (status 'stopped' follows once it closes), or close now if idle. */
  private finishOrClose(closeCode: number) {
    if (this.state === 'active' && this.stream) {
      this.state = 'stopping';
      this.stream.finish();
    } else {
      this.status('stopped');
      this.closeSocket(closeCode);
    }
  }

  /** Close immediately (shutdown grace period exhausted). */
  terminate(): void {
    this.cleanup('terminated');
    this.socket.terminate();
  }

  private send(msg: ServerMessage) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  private status(status: SessionStatus) {
    this.send({ type: 'session.status', status, sessionId: this.id });
  }

  private fail(code: ErrorCode) {
    if (this.state === 'closed') return;
    this.log.warn({ code }, 'session error');
    this.send({ type: 'session.error', code, message: ERROR_MESSAGES[code] });
    this.status('error');
    this.closeSocket(code === 'bad_message' || code === 'unsupported_version' ? 1008 : 1011);
  }

  private closeSocket(code: number) {
    this.cleanup('server closed');
    if (this.socket.readyState === this.socket.OPEN) this.socket.close(code);
  }

  private cleanup(reason: string) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearTimeout(this.startTimer);
    if (this.lifetimeTimer) clearTimeout(this.lifetimeTimer);
    this.stream?.close();
    this.stream = null;
    if (this.admitted) this.access.release(this.ip);
    this.onClosed();
    this.log.info({ reason }, 'session closed');
  }
}
