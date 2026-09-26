import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type { AsrCallbacks, ProviderErrorDetail, ProviderTranscript } from './AsrProvider';
import { AssemblyAiProvider } from './assemblyai';

const PCM = { encoding: 'linear16', sampleRate: 16000, channels: 1, language: 'en' } as const;

let wss: WebSocketServer | null = null;
afterEach(() => new Promise<void>((r) => (wss ? wss.close(() => r()) : r())));

/** Fake AssemblyAI endpoint; `onConnection` scripts its side of the session. */
async function fakeServer(onConnection: (ws: WebSocket) => void): Promise<string> {
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss!.once('listening', r));
  wss.on('connection', onConnection);
  return `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/v3/ws`;
}

function connect(url: string, overrides: Partial<AsrCallbacks> = {}) {
  const events: string[] = [];
  const transcripts: ProviderTranscript[] = [];
  let error: { code: string; detail?: ProviderErrorDetail } | null = null;
  const stream = new AssemblyAiProvider({
    apiKey: 'k',
    url,
    model: 'universal-streaming-english',
  }).connect(PCM, {
    onOpen: () => events.push('open'),
    onTranscript: (t) => transcripts.push(t),
    onError: (code, detail) => (error = { code, detail }),
    onClose: (expected) => events.push(`close:${expected}`),
    ...overrides,
  });
  return { stream, events, transcripts, error: () => error };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

const word = (text: string, final: boolean) => ({ text, word_is_final: final, start: 0, end: 1 });

describe('AssemblyAiProvider', () => {
  it('is ready at Begin, forwards words, and ends cleanly after Terminate', async () => {
    const received: Array<string | number> = [];
    const url = await fakeServer((ws) => {
      ws.send(JSON.stringify({ type: 'Begin', id: 'sess-1', expires_at: 0 }));
      ws.on('message', (d, bin) => {
        if (bin) return received.push((d as Buffer).length);
        received.push(JSON.parse(d.toString()).type);
        ws.send(
          JSON.stringify({
            type: 'Turn',
            turn_order: 0,
            end_of_turn: true,
            words: [word('hello', true), word('there', true)],
          }),
        );
        ws.send(JSON.stringify({ type: 'Termination' }));
      });
      ws.send(
        JSON.stringify({
          type: 'Turn',
          turn_order: 0,
          end_of_turn: false,
          words: [word('hello', true), word('the', false)],
        }),
      );
    });
    const c = connect(url);
    // Sent while connecting: buffered, then flushed on open.
    c.stream.sendAudio(Buffer.alloc(3200));
    await until(() => c.events.includes('open') && c.transcripts.length === 2);
    expect(c.transcripts.map((t) => `${t.kind}:${t.text}`)).toEqual(['final:hello', 'interim:the']);
    c.stream.finish();
    await until(() => c.events.includes('close:true'));
    expect(received).toEqual([3200, 'Terminate']);
    expect(c.transcripts.map((t) => `${t.kind}:${t.text}`).slice(2)).toEqual([
      'final:there',
      'interim:',
    ]);
    expect(c.error()).toBeNull();
  });

  it('reports a refused session with the Error message, and does not report it as ready', async () => {
    const url = await fakeServer((ws) => {
      ws.send(
        JSON.stringify({
          type: 'Error',
          error_code: 1008,
          error: 'Unauthorized Connection: Invalid API key',
        }),
      );
      ws.close(1008, 'See Error message for details');
    });
    const c = connect(url);
    await until(() => c.error() !== null);
    expect(c.error()).toEqual({
      code: 'asr_auth_failed',
      detail: {
        closeCode: 1008,
        reason: 'See Error message for details',
        sessionId: undefined,
        errorCode: 1008,
        error: 'Unauthorized Connection: Invalid API key',
      },
    });
    expect(c.events).not.toContain('open');
  });

  it('only asks the client to retry closes that a retry can fix', async () => {
    const codes: Record<number, string> = {};
    for (const closeCode of [3005, 3006, 3007, 3009]) {
      const url = await fakeServer((ws) => {
        ws.send(JSON.stringify({ type: 'Begin', id: 's', expires_at: 0 }));
        ws.close(closeCode);
      });
      const c = connect(url);
      await until(() => c.error() !== null);
      codes[closeCode] = c.error()!.code;
      await new Promise<void>((r) => wss!.close(() => r()));
      wss = null;
    }
    expect(codes).toEqual({
      3005: 'asr_unavailable',
      3006: 'asr_error',
      3007: 'asr_error',
      3009: 'server_busy',
    });
  });

  it('builds the URL for raw PCM with the configured model, keeping the key out of it', () => {
    const url = new URL(
      new AssemblyAiProvider({
        apiKey: 'k',
        url: 'wss://streaming.us.assemblyai.com/v3/ws',
        model: 'universal-streaming-english',
      }).buildUrl(PCM),
    );
    expect(url.origin + url.pathname).toBe('wss://streaming.us.assemblyai.com/v3/ws');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      speech_model: 'universal-streaming-english',
      encoding: 'pcm_s16le',
      sample_rate: '16000',
      format_turns: 'false',
      min_turn_silence: '160',
    });
  });

  it('backs off when AssemblyAI refuses a session for its rate limit (also close 1008)', async () => {
    const url = await fakeServer((ws) => {
      ws.send(
        JSON.stringify({
          type: 'Error',
          error_code: 1008,
          error: 'Unauthorized connection: Too many concurrent sessions',
        }),
      );
      ws.close(1008, 'See Error message for details');
    });
    const c = connect(url);
    await until(() => c.error() !== null);
    expect(c.error()!.code).toBe('server_busy');
  });

  it('warns when the session runs a different model than requested', async () => {
    const warnings: Array<{ detail: ProviderErrorDetail; message: string }> = [];
    const begin = (model: string) => (ws: WebSocket) =>
      ws.send(JSON.stringify({ type: 'Begin', id: 's', configuration: { model } }));
    for (const model of ['universal-streaming-english', 'universal-3-6-pro']) {
      const url = await fakeServer(begin(model));
      const c = connect(url, {
        onWarning: (detail, message) => warnings.push({ detail, message }),
      });
      await until(() => c.events.includes('open'));
      c.stream.close();
      await new Promise<void>((r) => wss!.close(() => r()));
      wss = null;
    }
    expect(warnings).toEqual([
      {
        detail: {
          requested: 'universal-streaming-english',
          applied: 'universal-3-6-pro',
          sessionId: 's',
        },
        message: 'provider applied a different model',
      },
    ]);
  });
});
