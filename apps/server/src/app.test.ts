import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, ServerMessage, packOpusPackets } from '@teleprompter/shared';
import { buildApp } from './app';
import { isAllowedOrigin } from './origin';
import { loadConfig } from './config';

const ORIGIN = 'http://localhost:5173';
const API_KEY = 'test-key-123';

type Upstream = {
  url: string;
  connections: Array<{ req: IncomingMessage; ws: WebSocket; received: Array<Buffer | string> }>;
  mode: 'ok' | 'reject401';
  close: () => Promise<void>;
};

/** Minimal fake of Deepgram's live endpoint. */
async function startUpstream(): Promise<Upstream> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const upstream: Upstream = {
    url: '',
    connections: [],
    mode: 'ok',
    close: () =>
      new Promise((resolve) => {
        for (const c of upstream.connections) c.ws.terminate();
        wss.close();
        http.close(() => resolve());
      }),
  };
  http.on('upgrade', (req, socket, head) => {
    if (upstream.mode === 'reject401') {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = { req, ws, received: [] as Array<Buffer | string> };
      upstream.connections.push(conn);
      ws.on('message', (data, isBinary) => {
        const buf = data as Buffer;
        conn.received.push(isBinary ? buf : buf.toString());
        if (!isBinary && JSON.parse(buf.toString()).type === 'CloseStream') ws.close(1000);
      });
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  upstream.url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/v1/listen`;
  return upstream;
}

type Client = {
  ws: WebSocket;
  messages: ServerMessage[];
  closed: Promise<number>;
  waitFor: (pred: (m: ServerMessage) => boolean, label?: string) => Promise<ServerMessage>;
};

function connectClient(
  url: string,
  origin = ORIGIN,
  headers: Record<string, string> = {},
): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin, headers });
    const messages: ServerMessage[] = [];
    const waiters: Array<{
      pred: (m: ServerMessage) => boolean;
      resolve: (m: ServerMessage) => void;
    }> = [];
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    ws.on('message', (data) => {
      const msg = ServerMessage.parse(JSON.parse(data.toString()));
      messages.push(msg);
      for (const w of [...waiters]) {
        if (w.pred(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    });
    ws.on('open', () =>
      resolve({
        ws,
        messages,
        closed,
        waitFor: (pred, label = 'message') =>
          new Promise((res, rej) => {
            const existing = messages.find(pred);
            if (existing) return res(existing);
            const timer = setTimeout(() => rej(new Error(`timed out waiting for ${label}`)), 3000);
            waiters.push({ pred, resolve: (m) => (clearTimeout(timer), res(m)) });
          }),
      }),
    );
    ws.on('error', reject);
  });
}

const start = (v = PROTOCOL_VERSION, accessCode?: string) =>
  JSON.stringify({
    type: 'session.start',
    v,
    language: 'en',
    audio: { encoding: 'linear16', sampleRate: 16000, channels: 1 },
    ...(accessCode !== undefined ? { accessCode } : {}),
  });

const isStatus = (status: string) => (m: ServerMessage) =>
  m.type === 'session.status' && m.status === status;

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(env: Record<string, string | undefined> = {}, pingIntervalMs?: number) {
  const upstream = await startUpstream();
  cleanups.push(upstream.close);
  const config = loadConfig({
    LOG_LEVEL: 'silent',
    DEEPGRAM_API_KEY: API_KEY,
    DEEPGRAM_URL: upstream.url,
    // Both providers use the fake; tests tell them apart by the query parameters.
    ASSEMBLYAI_URL: upstream.url,
    ...env,
  } as NodeJS.ProcessEnv);
  const { app, shutdown } = await buildApp({ config, pingIntervalMs });
  await app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(() => app.close());
  const port = (app.server.address() as AddressInfo).port;
  return { app, shutdown, upstream, wsUrl: `ws://127.0.0.1:${port}/ws` };
}

const until = async (cond: () => boolean, label: string) => {
  for (let i = 0; i < 150; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out: ${label}`);
};

function deepgramResult(start: number, transcript: string, isFinal: boolean) {
  return JSON.stringify({
    type: 'Results',
    start,
    duration: 1,
    is_final: isFinal,
    speech_final: isFinal,
    channel: { alternatives: [{ transcript, words: [] }] },
  });
}

describe('GET /health', () => {
  it('reports protocol version and whether ASR is configured', async () => {
    const { app } = await setup({ DEEPGRAM_API_KEY: '' });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({
      ok: true,
      protocolVersion: 1,
      asr: {
        provider: 'deepgram',
        configured: false,
        providers: [],
      },
      access: { codeRequired: false },
    });
  });

  it('offers every provider with a key, the default first, with the encodings each takes', async () => {
    const { app } = await setup({ ASR_PROVIDER: 'assemblyai', ASSEMBLYAI_API_KEY: API_KEY });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json().asr).toEqual({
      provider: 'assemblyai',
      configured: true,
      providers: [
        { name: 'assemblyai', encodings: ['linear16', 'opus_packets'] },
        { name: 'deepgram', encodings: ['linear16', 'opus', 'opus_packets'] },
      ],
    });
  });

  it('defaults to a provider that has a key when ASR_PROVIDER has none', async () => {
    const { app } = await setup({ ASR_PROVIDER: 'assemblyai' });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json().asr.provider).toBe('deepgram');
    expect(res.json().asr.configured).toBe(true);
  });
});

describe('provider choice', () => {
  const startWith = (provider: string) => JSON.stringify({ ...JSON.parse(start()), provider });

  it('connects to the provider the client names, or the default', async () => {
    const { wsUrl, upstream } = await setup({ ASSEMBLYAI_API_KEY: API_KEY });
    (await connectClient(wsUrl)).ws.send(startWith('assemblyai'));
    await until(() => upstream.connections.length === 1, 'assemblyai connection');
    expect(upstream.connections[0]!.req.url).toContain('speech_model=');
    (await connectClient(wsUrl)).ws.send(start());
    await until(() => upstream.connections.length === 2, 'default connection');
    expect(upstream.connections[1]!.req.url).toContain('model=nova-3');
  });

  it('refuses a provider that is unknown or has no key', async () => {
    const { wsUrl, upstream } = await setup();
    for (const name of ['assemblyai', 'nope']) {
      const client = await connectClient(wsUrl);
      client.ws.send(startWith(name));
      const err = await client.waitFor((m) => m.type === 'session.error', 'session.error');
      expect(err).toMatchObject({ code: 'asr_not_configured' });
    }
    expect(upstream.connections).toHaveLength(0);
  });
});

describe('audio encodings', () => {
  it('refuses an encoding the provider does not accept, before contacting it', async () => {
    const { wsUrl, upstream } = await setup({
      ASR_PROVIDER: 'assemblyai',
      ASSEMBLYAI_API_KEY: API_KEY,
    });
    const client = await connectClient(wsUrl);
    client.ws.send(
      JSON.stringify({
        type: 'session.start',
        v: PROTOCOL_VERSION,
        language: 'en',
        audio: { encoding: 'opus', container: 'webm' },
      }),
    );
    const err = await client.waitFor((m) => m.type === 'session.error', 'session.error');
    expect(err).toMatchObject({ code: 'bad_message' });
    expect(upstream.connections).toHaveLength(0);
  });

  const startPackets = JSON.stringify({
    type: 'session.start',
    v: PROTOCOL_VERSION,
    language: 'en',
    audio: { encoding: 'opus_packets', sampleRate: 16000, channels: 1 },
  });

  it('forwards Opus packets one per message, as the provider expects', async () => {
    const { wsUrl, upstream } = await setup();
    const client = await connectClient(wsUrl);
    client.ws.send(startPackets);
    await client.waitFor(isStatus('listening'), 'listening');
    const url = new URL(upstream.connections[0]!.req.url!, 'ws://x');
    expect(url.searchParams.get('encoding')).toBe('opus');
    client.ws.send(packOpusPackets([new Uint8Array([1, 1]), new Uint8Array([2, 2, 2])]));
    const received = () => upstream.connections[0]!.received.filter((r) => Buffer.isBuffer(r));
    await until(() => received().length === 2, 'packets upstream');
    expect(received()).toEqual([Buffer.from([1, 1]), Buffer.from([2, 2, 2])]);
  });

  it('ends the session on a malformed packet frame', async () => {
    const { wsUrl } = await setup();
    const client = await connectClient(wsUrl);
    client.ws.send(startPackets);
    await client.waitFor(isStatus('listening'), 'listening');
    client.ws.send(Buffer.from([0, 9, 1])); // claims 9 bytes, holds 1
    const err = await client.waitFor((m) => m.type === 'session.error', 'session.error');
    expect(err).toMatchObject({ code: 'bad_message' });
  });
});

describe('TRUST_PROXY parsing', () => {
  it('accepts booleans, hop counts and address lists', () => {
    const parse = (v: string) => loadConfig({ TRUST_PROXY: v } as NodeJS.ProcessEnv).trustProxy;
    expect(parse('false')).toBe(false);
    expect(parse('true')).toBe(true);
    expect(parse('1')).toBe(1);
    expect(parse('10.0.0.0/8,127.0.0.1')).toBe('10.0.0.0/8,127.0.0.1');
    expect(loadConfig({} as NodeJS.ProcessEnv).trustProxy).toBe(false);
  });

  it('defaults allow a group of speakers on one shared network', () => {
    const { limits } = loadConfig({} as NodeJS.ProcessEnv);
    expect(limits.maxSessionsPerIp).toBe(10);
    expect(limits.maxConcurrentSessions).toBe(10);
  });

  it('with a hop count, ignores client-supplied X-Forwarded-For entries', async () => {
    const { app } = await buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent', TRUST_PROXY: '1' } as NodeJS.ProcessEnv),
    });
    cleanups.push(() => app.close());
    let ip = '';
    app.addHook('onRequest', async (req) => {
      ip = req.ip;
    });
    await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' },
      remoteAddress: '10.0.0.2',
    });
    expect(ip).toBe('203.0.113.9');
  });
});

describe('GET /health CORS', () => {
  it('lets allowed front-end origins read it, and no one else', async () => {
    const { app } = await setup({ ALLOWED_ORIGINS: 'https://app.example.com' });
    const ok = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example.com' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.com');
    const other = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    expect(ok.headers['cache-control']).toBe('no-store');
  });
});

describe('session websocket', () => {
  it('relays audio upstream and normalized transcripts back, in order', async () => {
    const { upstream, wsUrl } = await setup();
    const client = await connectClient(wsUrl);
    client.ws.send(start());
    await client.waitFor(
      (m) => m.type === 'session.status' && m.status === 'listening',
      'listening',
    );
    expect(client.messages[0]).toMatchObject({ type: 'session.status', status: 'connecting' });

    const conn = upstream.connections[0]!;
    const url = new URL(conn.req.url!, 'ws://x');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      model: 'nova-3',
      language: 'en',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
    });
    expect(conn.req.headers.authorization).toBe(`Token ${API_KEY}`);

    const audio = Buffer.alloc(3200, 7);
    client.ws.send(audio);
    await until(() => conn.received.some((r) => Buffer.isBuffer(r)), 'audio upstream');
    expect(conn.received.find((r) => Buffer.isBuffer(r))).toEqual(audio);

    conn.ws.send(deepgramResult(0, 'good morning', false));
    conn.ws.send(deepgramResult(0, 'good morning and', false));
    conn.ws.send(deepgramResult(0, 'good morning and thank you', true));
    conn.ws.send(JSON.stringify({ type: 'SpeechStarted', timestamp: 1 }));
    conn.ws.send(deepgramResult(1.5, 'very much', false));
    await client.waitFor(
      (m) => m.type === 'transcript.interim' && m.text === 'very much',
      'interim 2',
    );

    const transcripts = client.messages.filter((m) => m.type.startsWith('transcript.'));
    expect(
      transcripts.map((m) => [m.type, 'text' in m && m.text, 'segmentId' in m && m.segmentId]),
    ).toEqual([
      ['transcript.interim', 'good morning', 'dg-0'],
      ['transcript.interim', 'good morning and', 'dg-0'],
      ['transcript.final', 'good morning and thank you', 'dg-0'],
      ['transcript.interim', 'very much', 'dg-1500'],
    ]);
    const seqs = transcripts.map((m) => ('sequence' in m ? m.sequence : -1));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(transcripts.map((m) => 'sessionId' in m && m.sessionId)).size).toBe(1);

    client.ws.send(JSON.stringify({ type: 'session.stop' }));
    await client.waitFor((m) => m.type === 'session.status' && m.status === 'stopped', 'stopped');
    const control = conn.received
      .filter((r): r is string => typeof r === 'string')
      .map((r) => JSON.parse(r).type);
    expect(control.slice(-2)).toEqual(['Finalize', 'CloseStream']);
    expect(await client.closed).toBe(1000);
  });

  it('buffers early audio (bounded) until the provider connection opens', async () => {
    const { upstream, wsUrl } = await setup();
    const client = await connectClient(wsUrl);
    client.ws.send(start());
    client.ws.send(Buffer.alloc(3200, 1));
    client.ws.send(Buffer.alloc(3200, 2));
    await until(() => (upstream.connections[0]?.received.length ?? 0) >= 2, 'buffered audio');
    const received = upstream.connections[0]!.received as Buffer[];
    expect(received.map((b) => b[0])).toEqual([1, 2]);
  });

  it('relays Opus chunks of any length, in order, without PCM parameters', async () => {
    const { upstream, wsUrl } = await setup();
    const client = await connectClient(wsUrl);
    client.ws.send(
      JSON.stringify({
        type: 'session.start',
        v: PROTOCOL_VERSION,
        language: 'en',
        audio: { encoding: 'opus', container: 'webm' },
      }),
    );
    client.ws.send(Buffer.alloc(333, 1)); // odd length: fine for compressed audio
    client.ws.send(Buffer.alloc(101, 2));
    await until(() => (upstream.connections[0]?.received.length ?? 0) >= 2, 'opus chunks');
    const conn = upstream.connections[0]!;
    expect((conn.received as Buffer[]).map((b) => [b[0], b.length])).toEqual([
      [1, 333],
      [2, 101],
    ]);
    const params = new URL(conn.req.url!, 'ws://x').searchParams;
    expect(params.has('encoding')).toBe(false);
    expect(params.has('sample_rate')).toBe(false);
  });

  it('acknowledges received audio chunks regularly, which doubles as a heartbeat', async () => {
    const { upstream, wsUrl } = await setup();
    const client = await connectClient(wsUrl);
    client.ws.send(start());
    await client.waitFor(isStatus('listening'), 'listening');
    for (const n of [1, 2, 3]) client.ws.send(Buffer.alloc(320, n));
    await until(() => (upstream.connections[0]?.received.length ?? 0) >= 3, 'audio upstream');
    await client.waitFor((m) => m.type === 'session.ack' && m.chunks === 3, 'ack of 3 chunks');
    // Acks keep coming while nothing new arrives.
    const acks = () => client.messages.filter((m) => m.type === 'session.ack').length;
    const before = acks();
    await new Promise((r) => setTimeout(r, 600));
    expect(acks()).toBeGreaterThanOrEqual(before + 2);
  });

  it('ends the session a reconnecting client replaces, together with its provider stream', async () => {
    const { upstream, wsUrl } = await setup();
    const first = await connectClient(wsUrl);
    first.ws.send(start());
    const listening = await first.waitFor(isStatus('listening'), 'first listening');
    const oldId = listening.type === 'session.status' ? listening.sessionId! : '';

    const second = await connectClient(wsUrl);
    second.ws.send(JSON.stringify({ ...JSON.parse(start()), replaces: oldId }));
    await second.waitFor(isStatus('listening'), 'second listening');
    await first.closed;
    await until(
      () => upstream.connections[0]!.ws.readyState === WebSocket.CLOSED,
      'old upstream closed',
    );
    expect(second.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('ends sessions whose client stopped answering pings (lost signal without closing)', async () => {
    const { upstream, wsUrl } = await setup({}, 100);
    const silent = await new Promise<WebSocket>((resolve) => {
      const ws = new WebSocket(wsUrl, { origin: ORIGIN, autoPong: false });
      ws.on('open', () => resolve(ws));
    });
    silent.send(start());
    const healthy = await connectClient(wsUrl);
    healthy.ws.send(start());
    await healthy.waitFor(isStatus('listening'), 'listening');
    const closedCode = await new Promise<number>((r) => silent.on('close', (code) => r(code)));
    expect(closedCode).toBe(1006); // dropped, not closed politely
    await until(
      () => upstream.connections.filter((c) => c.ws.readyState === WebSocket.OPEN).length === 1,
      'one upstream left',
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(healthy.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('fails fast with a safe error when no API key is configured', async () => {
    const { upstream, wsUrl } = await setup({ DEEPGRAM_API_KEY: '' });
    const client = await connectClient(wsUrl);
    client.ws.send(start());
    const err = await client.waitFor((m) => m.type === 'session.error', 'error');
    expect(err).toMatchObject({ code: 'asr_not_configured' });
    expect(await client.closed).toBe(1011);
    expect(upstream.connections).toHaveLength(0);
  });

  it('reports provider auth failure without leaking the key', async () => {
    const { upstream, wsUrl } = await setup();
    upstream.mode = 'reject401';
    const client = await connectClient(wsUrl);
    client.ws.send(start());
    const err = await client.waitFor((m) => m.type === 'session.error', 'error');
    expect(err).toMatchObject({ code: 'asr_auth_failed' });
    expect(JSON.stringify(client.messages)).not.toContain(API_KEY);
  });

  it('reports disconnection when the provider drops the stream', async () => {
    const { upstream, wsUrl } = await setup();
    const client = await connectClient(wsUrl);
    client.ws.send(start());
    await client.waitFor(
      (m) => m.type === 'session.status' && m.status === 'listening',
      'listening',
    );
    upstream.connections[0]!.ws.close(1011, 'NET-0001');
    const status = await client.waitFor(
      (m) => m.type === 'session.status' && (m.status === 'disconnected' || m.status === 'error'),
      'dropped',
    );
    expect(status).toMatchObject({ type: 'session.status' });
    expect(
      client.messages.some((m) => m.type === 'session.error' && m.code === 'asr_unavailable'),
    ).toBe(true);
    await client.closed;
  });

  it('closes the provider stream when the client disconnects', async () => {
    const { upstream, wsUrl } = await setup();
    const client = await connectClient(wsUrl);
    client.ws.send(start());
    await client.waitFor(
      (m) => m.type === 'session.status' && m.status === 'listening',
      'listening',
    );
    const upstreamClosed = new Promise((r) => upstream.connections[0]!.ws.on('close', r));
    client.ws.close();
    await upstreamClosed;
  });

  it('rejects unexpected message types, bad versions and oversize frames', async () => {
    const { wsUrl } = await setup();
    const a = await connectClient(wsUrl);
    a.ws.send(JSON.stringify({ type: 'shell.exec', cmd: 'ls' }));
    expect(await a.waitFor((m) => m.type === 'session.error')).toMatchObject({
      code: 'bad_message',
    });
    expect(await a.closed).toBe(1008);

    const b = await connectClient(wsUrl);
    b.ws.send(start(99));
    expect(await b.waitFor((m) => m.type === 'session.error')).toMatchObject({
      code: 'unsupported_version',
    });

    const c = await connectClient(wsUrl);
    c.ws.send(start());
    c.ws.send(Buffer.alloc(3201));
    expect(await c.waitFor((m) => m.type === 'session.error')).toMatchObject({
      code: 'bad_message',
    });
  });

  it('refuses upgrades from other origins', async () => {
    const { wsUrl } = await setup();
    await expect(connectClient(wsUrl, 'https://evil.example')).rejects.toThrow(/403/);
  });

  it('accepts same-origin pages, e.g. a phone loading the app over the LAN', async () => {
    const { wsUrl } = await setup();
    const sameOrigin = `https://${new URL(wsUrl).host}`;
    const client = await connectClient(wsUrl, sameOrigin);
    client.ws.send(start());
    await client.waitFor(
      (m) => m.type === 'session.status' && m.status === 'listening',
      'listening',
    );
  });
});

describe('isAllowedOrigin', () => {
  it('allows configured and same-origin pages only', () => {
    const list = ['http://localhost:5173'];
    expect(isAllowedOrigin('http://localhost:5173', 'x:1', list)).toBe(true);
    expect(isAllowedOrigin('https://192.168.1.20:5173', '192.168.1.20:5173', list)).toBe(true);
    expect(isAllowedOrigin('https://evil.example', '192.168.1.20:5173', list)).toBe(false);
    expect(isAllowedOrigin('https://192.168.1.20.evil.example', '192.168.1.20:5173', list)).toBe(
      false,
    );
    expect(isAllowedOrigin(undefined, '192.168.1.20:5173', list)).toBe(false);
    expect(isAllowedOrigin('null', '192.168.1.20:5173', list)).toBe(false);
    // DNS rebinding: attacker hostname resolving to this machine sends matching Origin/Host.
    expect(
      isAllowedOrigin('http://rebind.evil.example:8787', 'rebind.evil.example:8787', list),
    ).toBe(false);
    expect(isAllowedOrigin('http://8.8.8.8:8787', '8.8.8.8:8787', list)).toBe(false);
    expect(isAllowedOrigin('https://10.0.0.5:5173', '10.0.0.5:5173', list)).toBe(true);
    expect(isAllowedOrigin('https://172.20.1.2:5173', '172.20.1.2:5173', list)).toBe(true);
  });
});

describe('deployment safeguards', () => {
  it('requires the access code when APP_ACCESS_CODE is set', async () => {
    const { app, wsUrl } = await setup({ APP_ACCESS_CODE: 'rehearse-42' });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json().access).toEqual({ codeRequired: true });

    const denied = await connectClient(wsUrl);
    denied.ws.send(start(PROTOCOL_VERSION, 'wrong'));
    expect(await denied.waitFor((m) => m.type === 'session.error')).toMatchObject({
      code: 'access_denied',
    });
    expect(JSON.stringify(denied.messages)).not.toContain('rehearse-42');

    const ok = await connectClient(wsUrl);
    ok.ws.send(start(PROTOCOL_VERSION, 'rehearse-42'));
    await ok.waitFor(isStatus('listening'), 'listening');
  });

  it('rejects sessions beyond the per-IP cap and frees the slot when one closes', async () => {
    const { wsUrl } = await setup({ MAX_SESSIONS_PER_IP: '1' });
    const a = await connectClient(wsUrl);
    a.ws.send(start());
    await a.waitFor(isStatus('listening'), 'a listening');
    const b = await connectClient(wsUrl);
    b.ws.send(start());
    expect(await b.waitFor((m) => m.type === 'session.error')).toMatchObject({
      code: 'server_busy',
    });
    a.ws.close();
    await a.closed;
    await new Promise((r) => setTimeout(r, 50));
    const c = await connectClient(wsUrl);
    c.ws.send(start());
    await c.waitFor(isStatus('listening'), 'c listening');
  });

  it('uses the proxy-forwarded client IP for per-IP limits when TRUST_PROXY is on', async () => {
    const { wsUrl } = await setup({ MAX_SESSIONS_PER_IP: '1', TRUST_PROXY: 'true' });
    const a = await connectClient(wsUrl, ORIGIN, { 'x-forwarded-for': '203.0.113.1' });
    a.ws.send(start());
    await a.waitFor(isStatus('listening'), 'a');
    const b = await connectClient(wsUrl, ORIGIN, { 'x-forwarded-for': '203.0.113.2' });
    b.ws.send(start());
    await b.waitFor(isStatus('listening'), 'b (different client IP)');
    const c = await connectClient(wsUrl, ORIGIN, { 'x-forwarded-for': '203.0.113.1' });
    c.ws.send(start());
    expect(await c.waitFor((m) => m.type === 'session.error')).toMatchObject({
      code: 'server_busy',
    });
  });

  it('ends a session gracefully at the time limit, finalizing pending speech', async () => {
    const { upstream, wsUrl } = await setup({ MAX_SESSION_MINUTES: '0.01' }); // 600 ms
    const client = await connectClient(wsUrl);
    client.ws.send(start());
    await client.waitFor(isStatus('listening'), 'listening');
    expect(await client.waitFor((m) => m.type === 'session.error')).toMatchObject({
      code: 'session_time_limit',
    });
    await client.waitFor(isStatus('stopped'), 'stopped');
    const control = upstream.connections[0]!.received.filter(
      (r): r is string => typeof r === 'string',
    );
    expect(control.map((r) => JSON.parse(r).type)).toEqual(['Finalize', 'CloseStream']);
  });

  it('on shutdown, finalizes open sessions and tells clients to reconnect', async () => {
    const { shutdown, upstream, wsUrl } = await setup();
    const client = await connectClient(wsUrl);
    client.ws.send(start());
    await client.waitFor(isStatus('listening'), 'listening');
    await shutdown(2000);
    expect(
      client.messages.some((m) => m.type === 'session.error' && m.code === 'server_restarting'),
    ).toBe(true);
    const control = upstream.connections[0]!.received.filter(
      (r): r is string => typeof r === 'string',
    );
    expect(control.map((r) => JSON.parse(r).type)).toContain('Finalize');
    await client.closed;
  });
});
