import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { DeepgramProvider } from './deepgram';

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
    expect(url.searchParams.get('endpointing')).toBe('300');
    expect(url.searchParams.get('smart_format')).toBe('false');
    // Credentials go in the Authorization header, never the URL.
    expect([...url.searchParams.values()]).not.toContain('k');
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
});
