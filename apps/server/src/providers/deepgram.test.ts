import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { ProviderErrorDetail } from './AsrProvider';
import { DeepgramProvider } from './deepgram';

const PCM = { encoding: 'linear16', sampleRate: 16000, channels: 1, language: 'en' } as const;

/** Connect to `url` and resolve with the first error the stream reports. */
function firstError(url: string) {
  return new Promise<{ code: string; detail?: ProviderErrorDetail }>((resolve) =>
    new DeepgramProvider({ apiKey: 'k', url, model: 'nova-3' }).connect(PCM, {
      onOpen: () => {},
      onTranscript: () => {},
      onError: (code, detail) => resolve({ code, detail }),
      onClose: () => {},
    }),
  );
}

let wss: WebSocketServer | null = null;
afterEach(() => new Promise<void>((r) => (wss ? wss.close(() => r()) : r())));

describe('DeepgramProvider', () => {
  it('sends KeepAlive while no audio flows and stops after close', async () => {
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => wss!.once('listening', r));
    const received: string[] = [];
    wss.on('connection', (ws) =>
      ws.on('message', (d, bin) => !bin && received.push(JSON.parse(d.toString()).type)),
    );
    const provider = new DeepgramProvider({
      apiKey: 'k',
      url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/v1/listen`,
      model: 'nova-3',
      keepAliveMs: 300,
    });
    let opened = false;
    let closedExpected: boolean | null = null;
    const stream = provider.connect(
      { encoding: 'linear16', sampleRate: 16000, channels: 1, language: 'en' },
      {
        onOpen: () => (opened = true),
        onTranscript: () => {},
        onError: () => {},
        onClose: (expected) => (closedExpected = expected),
      },
    );
    await new Promise((r) => setTimeout(r, 900));
    expect(opened).toBe(true);
    expect(received.filter((t) => t === 'KeepAlive').length).toBeGreaterThanOrEqual(1);
    stream.close();
    expect(closedExpected).toBe(true);
    const count = received.length;
    await new Promise((r) => setTimeout(r, 500));
    expect(received.length).toBe(count);
  });

  it('gives up on a provider connection that never opens, so the client can retry', async () => {
    // Accepts the TCP connection but never answers the WebSocket upgrade.
    const { createServer } = await import('node:net');
    const blackhole = createServer(() => {});
    await new Promise<void>((r) => blackhole.listen(0, '127.0.0.1', r));
    const provider = new DeepgramProvider({
      apiKey: 'k',
      url: `ws://127.0.0.1:${(blackhole.address() as AddressInfo).port}/v1/listen`,
      model: 'nova-3',
      connectTimeoutMs: 150,
    });
    const started = Date.now();
    const error = await new Promise<string>((resolve) =>
      provider.connect(
        { encoding: 'linear16', sampleRate: 16000, channels: 1, language: 'en' },
        { onOpen: () => {}, onTranscript: () => {}, onError: resolve, onClose: () => {} },
      ),
    );
    expect(error).toBe('asr_unavailable');
    expect(Date.now() - started).toBeLessThan(1000);
    blackhole.close();
  });

  it('builds the listen URL with the configured model and audio format', () => {
    const url = new URL(
      new DeepgramProvider({
        apiKey: 'k',
        url: 'wss://api.deepgram.com/v1/listen',
        model: 'nova-3',
      }).buildUrl({
        encoding: 'linear16',
        sampleRate: 16000,
        channels: 1,
        language: 'en',
      }),
    );
    expect(url.origin + url.pathname).toBe('wss://api.deepgram.com/v1/listen');
    expect(url.searchParams.get('endpointing')).toBe('10');
    expect(url.searchParams.get('mip_opt_out')).toBe('true');
    expect(url.searchParams.get('smart_format')).toBe('false');
    // Credentials go in the Authorization header, never the URL.
    expect([...url.searchParams.values()]).not.toContain('k');
  });

  it('describes raw Opus packets, which have no header', () => {
    const url = new URL(
      new DeepgramProvider({
        apiKey: 'k',
        url: 'wss://api.deepgram.com/v1/listen',
        model: 'nova-3',
      }).buildUrl({ encoding: 'opus_packets', sampleRate: 16000, channels: 1, language: 'en' }),
    );
    expect(url.searchParams.get('encoding')).toBe('opus');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('channels')).toBe('1');
  });

  it('lets Deepgram read containerized Opus from its header', () => {
    const url = new URL(
      new DeepgramProvider({
        apiKey: 'k',
        url: 'wss://api.deepgram.com/v1/listen',
        model: 'nova-3',
      }).buildUrl({ encoding: 'opus', container: 'webm', language: 'en' }),
    );
    expect(url.searchParams.get('model')).toBe('nova-3');
    for (const p of ['encoding', 'sample_rate', 'channels'])
      expect(url.searchParams.has(p)).toBe(false);
  });

  it('only asks the client to retry refusals that a retry can fix', async () => {
    const { createServer } = await import('node:http');
    let status = 0;
    const server = createServer();
    server.on('upgrade', (_req, socket) => {
      socket.end(
        `HTTP/1.1 ${status} Refused\r\ndg-error: why\r\ndg-request-id: req-1\r\n` +
          'Content-Length: 0\r\n\r\n',
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/listen`;
    const codes: Record<number, string> = {};
    for (status of [400, 402, 429, 500]) {
      const { code, detail } = await firstError(url);
      codes[status] = code;
      expect(detail).toEqual({ status, dgError: 'why', requestId: 'req-1' });
    }
    // Bad request / out of credit won't change on a retry; 429 backs off; 5xx is Deepgram's side.
    expect(codes).toEqual({
      400: 'asr_error',
      402: 'asr_error',
      429: 'server_busy',
      500: 'asr_unavailable',
    });
    server.close();
  });

  it('reports undecodable audio (close 1008) with the reason and request id', async () => {
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => wss!.once('listening', r));
    wss.on('headers', (headers) => headers.push('dg-request-id: req-2'));
    wss.on('connection', (ws) => ws.close(1008, 'DATA-0000'));
    const { code, detail } = await firstError(
      `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/v1/listen`,
    );
    expect(code).toBe('asr_error');
    expect(detail).toEqual({ closeCode: 1008, reason: 'DATA-0000', requestId: 'req-2' });
  });

  it('never forwards an empty audio frame, which would end the Deepgram stream', async () => {
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => wss!.once('listening', r));
    const frames: number[] = [];
    wss.on('connection', (ws) =>
      ws.on('message', (d, bin) => bin && frames.push((d as Buffer).length)),
    );
    let opened = false;
    const stream = new DeepgramProvider({
      apiKey: 'k',
      url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/v1/listen`,
      model: 'nova-3',
    }).connect(PCM, {
      onOpen: () => (opened = true),
      onTranscript: () => {},
      onError: () => {},
      onClose: () => {},
    });
    for (let i = 0; i < 50 && !opened; i++) await new Promise((r) => setTimeout(r, 10));
    stream.sendAudio(Buffer.alloc(0));
    stream.sendAudio(Buffer.alloc(320));
    await new Promise((r) => setTimeout(r, 100));
    expect(frames).toEqual([320]);
    stream.close();
  });
});
