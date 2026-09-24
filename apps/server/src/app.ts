import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { MAX_AUDIO_FRAME_BYTES, PROTOCOL_VERSION, type HealthResponse } from '@teleprompter/shared';
import { AccessControl } from './accessControl';
import type { ServerConfig } from './config';
import type { AsrProvider } from './providers/AsrProvider';
import { isAllowedOrigin } from './origin';
import { DeepgramProvider } from './providers/deepgram';
import { registerSessionRoute, type Session } from './sessionSocket';

type AppOptions = {
  config: ServerConfig;
  provider?: AsrProvider;
  /** Tests shorten the client liveness check. */
  pingIntervalMs?: number;
};

export async function buildApp({ config, provider, pingIntervalMs }: AppOptions) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Never log credentials if request headers are logged.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // Set when a reverse proxy in front sets X-Forwarded-For to the real client IP. A hop count
    // trusts that many proxies nearest the server.
    trustProxy:
      typeof config.trustProxy === 'number'
        ? (_address: string, hop: number) => hop < (config.trustProxy as number)
        : config.trustProxy,
  });
  const asr = provider ?? new DeepgramProvider(config.deepgram);
  const access = new AccessControl(config.limits);
  const sessions = new Set<Session>();

  await app.register(websocket, { options: { maxPayload: MAX_AUDIO_FRAME_BYTES + 1024 } });
  app.get('/health', async (request, reply): Promise<HealthResponse> => {
    // Readable cross-origin by allowed front ends (when the web app is hosted separately).
    const origin = request.headers.origin;
    if (isAllowedOrigin(origin, request.headers.host, config.allowedOrigins)) {
      reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    }
    // Never cached by CDNs or proxies in front: it reflects live configuration.
    reply.header('Cache-Control', 'no-store');
    return {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      asr: { provider: asr.name, configured: asr.configured },
      access: { codeRequired: access.codeRequired },
    };
  });
  registerSessionRoute(app, {
    provider: asr,
    allowedOrigins: config.allowedOrigins,
    access,
    sessions,
    pingIntervalMs,
  });

  /**
   * Graceful shutdown (SIGTERM on redeploy): stop accepting connections, ask every open session
   * to finalize and tell its client to reconnect, then force-close whatever remains.
   */
  async function shutdown(graceMs = config.shutdownGraceMs): Promise<void> {
    app.log.info({ sessions: sessions.size }, 'shutting down');
    const ending = Promise.all([...sessions].map((s) => s.end('server_restarting')));
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([ending, new Promise((r) => (timer = setTimeout(r, graceMs)))]);
    clearTimeout(timer);
    for (const s of sessions) s.terminate();
    await app.close();
  }

  // Returned in a plain object: a Fastify instance is thenable, so returning it from an async
  // function would resolve through its `then` rather than hand back the instance.
  return { app, shutdown };
}
