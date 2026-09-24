import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsrClient, type AsrClientHandlers } from './asrClient';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeWebSocket | null = null;
  readyState = FakeWebSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType = 'blob';
  sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private listeners: Array<() => void> = [];
  constructor(readonly url: string) {
    FakeWebSocket.last = this;
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
    this.listeners.forEach((l) => l());
  }
  addEventListener(_: 'close', l: () => void) {
    this.listeners.push(l);
  }
  // Test helpers
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }
}

function handlers(): AsrClientHandlers & {
  [K in keyof AsrClientHandlers]: ReturnType<typeof vi.fn>;
} {
  return { onStatus: vi.fn(), onTranscript: vi.fn(), onError: vi.fn(), onClose: vi.fn() } as never;
}

beforeEach(() => vi.stubGlobal('WebSocket', FakeWebSocket));
afterEach(() => vi.unstubAllGlobals());

describe('AsrClient', () => {
  it('sends session.start on open and maps server messages to handlers', () => {
    const h = handlers();
    const client = new AsrClient('ws://x/ws', h);
    client.connect();
    const ws = FakeWebSocket.last!;
    ws.open();
    expect(JSON.parse(ws.sent[0] as string)).toEqual({
      type: 'session.start',
      v: 1,
      language: 'en',
      audio: { encoding: 'linear16', sampleRate: 16000, channels: 1 },
    });
    ws.receive({ type: 'session.status', status: 'listening', sessionId: 's' });
    ws.receive({
      type: 'transcript.final',
      sessionId: 's',
      segmentId: 'dg-0',
      segmentOrder: 0,
      sequence: 3,
      text: 'hello there',
    });
    ws.receive({ type: 'session.error', code: 'asr_error', message: 'Provider error' });
    expect(h.onStatus).toHaveBeenCalledWith('listening');
    expect(h.onTranscript).toHaveBeenCalledWith({
      sessionId: 's',
      segmentId: 'dg-0',
      segmentOrder: 0,
      sequence: 3,
      text: 'hello there',
      kind: 'final',
    });
    expect(h.onError).toHaveBeenCalledWith('asr_error', 'Provider error');
  });

  it('includes the access code in session.start when provided', () => {
    const client = new AsrClient('ws://x/ws', handlers(), { accessCode: 'secret-code' });
    client.connect();
    FakeWebSocket.last!.open();
    expect(JSON.parse(FakeWebSocket.last!.sent[0] as string).accessCode).toBe('secret-code');
  });

  it('ignores malformed and unknown server messages', () => {
    const h = handlers();
    const client = new AsrClient('ws://x/ws', h);
    client.connect();
    const ws = FakeWebSocket.last!;
    ws.open();
    ws.receive('not json');
    ws.receive({ type: 'surprise' });
    ws.receive({ type: 'transcript.final', text: 'missing fields' });
    expect(h.onTranscript).not.toHaveBeenCalled();
    expect(h.onStatus).not.toHaveBeenCalled();
  });

  it('holds audio while connecting and sends it right after session.start', () => {
    const client = new AsrClient('ws://x/ws', handlers(), { maxBufferedBytes: 7000 });
    client.connect();
    const ws = FakeWebSocket.last!;
    const frames = [1, 2, 3].map((n) => new Uint8Array(3200).fill(n).buffer);
    for (const f of frames) expect(client.sendAudio(f)).toBe(true);
    expect(ws.sent).toHaveLength(0);
    ws.open();
    expect(JSON.parse(ws.sent[0] as string).type).toBe('session.start');
    // Bounded: the oldest frame was dropped to stay under the limit.
    expect(ws.sent.slice(1)).toEqual(frames.slice(1));
  });

  it('drops audio when the socket is backed up or closed', () => {
    const client = new AsrClient('ws://x/ws', handlers(), { maxBufferedBytes: 1000 });
    client.connect();
    const ws = FakeWebSocket.last!;
    ws.open();
    expect(client.sendAudio(new ArrayBuffer(3200))).toBe(true);
    ws.bufferedAmount = 5000;
    expect(client.sendAudio(new ArrayBuffer(3200))).toBe(false);
    ws.close();
    expect(client.sendAudio(new ArrayBuffer(3200))).toBe(false);
  });

  it('streams Opus without ever dropping a chunk, ending the session if the network backs up', () => {
    const h = handlers();
    const client = new AsrClient('ws://x/ws', h, {
      audio: { encoding: 'opus', container: 'webm' },
    });
    client.connect();
    const ws = FakeWebSocket.last!;
    const chunks = Array.from({ length: 30 }, (_, n) => new Uint8Array(1000).fill(n).buffer);
    for (const c of chunks) expect(client.sendAudio(c)).toBe(true); // 30 KB while connecting
    ws.open();
    expect(JSON.parse(ws.sent[0] as string).audio).toEqual({ encoding: 'opus', container: 'webm' });
    expect(ws.sent.slice(1)).toEqual(chunks); // all of them, header chunk first
    ws.bufferedAmount = 20_000;
    expect(client.sendAudio(new ArrayBuffer(500))).toBe(false);
    expect(h.onError).toHaveBeenCalledWith('network_slow', expect.any(String));
    expect(h.onClose).toHaveBeenCalledWith(true);
  });

  it('measures recognition delay from interim word timings, and the upload queue', () => {
    let now = 1_000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const client = new AsrClient('ws://x/ws', handlers(), {
      audio: { encoding: 'opus', container: 'webm' },
    });
    client.connect();
    const ws = FakeWebSocket.last!;
    expect(client.metrics()).toEqual({ delayMs: null, backlogMs: 0 });
    client.sendAudio(new ArrayBuffer(400)); // audio clock starts one 100 ms frame earlier: 900
    ws.open();
    const result = (type: string, endMs: number) => ({
      type,
      sessionId: 's',
      segmentId: 'dg-0',
      segmentOrder: 0,
      sequence: 1,
      text: 'hello',
      words: [{ text: 'hello', startMs: endMs - 300, endMs }],
    });
    now = 2_500;
    ws.receive(result('transcript.interim', 1_200)); // said at 900 + 1200 = 2100, heard at 2500
    expect(client.metrics().delayMs).toBe(400);
    now = 2_600;
    ws.receive(result('transcript.final', 100)); // finals may end early: not timed
    expect(client.metrics().delayMs).toBe(400);
    ws.bufferedAmount = 8_000; // 2 s of 32 kbit/s Opus
    expect(client.metrics().backlogMs).toBe(2_000);
    clock.mockRestore();
  });

  it('stop() requests finalization and reports an intentional close', async () => {
    const h = handlers();
    const client = new AsrClient('ws://x/ws', h);
    client.connect();
    const ws = FakeWebSocket.last!;
    ws.open();
    const done = client.stop();
    expect(JSON.parse(ws.sent.at(-1) as string)).toEqual({ type: 'session.stop' });
    ws.close();
    await done;
    expect(h.onClose).toHaveBeenCalledWith(true);
  });

  it('reports an unintentional close and a failed connection', () => {
    const h = handlers();
    const client = new AsrClient('ws://x/ws', h);
    client.connect();
    const ws = FakeWebSocket.last!;
    ws.onerror?.();
    ws.close();
    expect(h.onError).toHaveBeenCalledWith('connection_failed', expect.any(String));
    expect(h.onClose).toHaveBeenCalledWith(false);
  });
});
