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

  it('drops audio instead of queueing when the socket is backed up or not open', () => {
    const client = new AsrClient('ws://x/ws', handlers(), { maxBufferedBytes: 1000 });
    client.connect();
    const ws = FakeWebSocket.last!;
    expect(client.sendAudio(new ArrayBuffer(3200))).toBe(false); // still connecting
    ws.open();
    expect(client.sendAudio(new ArrayBuffer(3200))).toBe(true);
    ws.bufferedAmount = 5000;
    expect(client.sendAudio(new ArrayBuffer(3200))).toBe(false);
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
