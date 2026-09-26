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

  describe('link health', () => {
    beforeEach(() =>
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
      }),
    );
    afterEach(() => vi.useRealTimers());

    const listening = { type: 'session.status', status: 'listening', sessionId: 'sess-1' };
    const ack = (chunks: number) => ({ type: 'session.ack', chunks });
    const audioSent = (ws: FakeWebSocket) => ws.sent.filter((d) => typeof d !== 'string');
    function live(h = handlers()) {
      const client = new AsrClient('ws://x/ws', h, {
        audio: { encoding: 'opus', container: 'webm' },
      });
      client.connect();
      const ws = FakeWebSocket.last!;
      ws.open();
      return { client, ws, h };
    }
    /** Send one 100 ms chunk, as the recorder would. */
    const chunk = (client: AsrClient) => {
      client.sendAudio(new ArrayBuffer(400));
      vi.advanceTimersByTime(100);
    };

    it('holds audio until the recognizer is listening, then sends it while still fresh', () => {
      const { client, ws } = live();
      for (let i = 0; i < 5; i++) chunk(client); // 0.5 s while the recognizer starts
      expect(audioSent(ws)).toHaveLength(0);
      ws.receive(listening);
      expect(audioSent(ws)).toHaveLength(5); // the first words still count
      chunk(client);
      expect(audioSent(ws)).toHaveLength(6);
    });

    it('drops held audio that went stale while connecting, and restarts the stream', () => {
      const h = { ...handlers(), onStaleStart: vi.fn() };
      const { client, ws } = live(h);
      for (let i = 0; i < 20; i++) chunk(client); // 2 s: a slow start
      ws.receive(listening);
      expect(h.onStaleStart).toHaveBeenCalledTimes(1);
      expect(audioSent(ws)).toHaveLength(0);
      chunk(client);
      expect(audioSent(ws)).toHaveLength(1);
    });

    it('rides out a short blip without reconnecting', () => {
      const { client, ws, h } = live();
      ws.receive(listening);
      let sent = 0;
      const tick = (acked: boolean) => {
        chunk(client);
        sent++;
        if (acked) ws.receive(ack(sent));
        else ws.receive(ack(sent - (sent % 100))); // heartbeat keeps coming, no progress
      };
      for (let i = 0; i < 10; i++) tick(true);
      const stalledAt = sent;
      for (let i = 0; i < 8; i++) {
        chunk(client); // 0.8 s with the upload stuck
        sent++;
        ws.receive(ack(stalledAt));
      }
      ws.receive(ack(sent)); // the link recovers and everything is acknowledged
      for (let i = 0; i < 10; i++) tick(true);
      expect(h.onError).not.toHaveBeenCalled();
    });

    it('replaces a link whose upload stops being acknowledged', () => {
      const { client, ws, h } = live();
      ws.receive(listening);
      chunk(client);
      ws.receive(ack(1));
      for (let i = 0; i < 13; i++) {
        chunk(client);
        ws.receive(ack(1)); // the server is heard, but none of the new audio arrives
      }
      expect(h.onError).toHaveBeenCalledWith('connection_stalled', expect.any(String));
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    });

    it('replaces a link when the server falls silent', () => {
      const { ws, h } = live();
      ws.receive(listening);
      ws.receive(ack(0));
      vi.advanceTimersByTime(1_100);
      expect(h.onError).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(h.onError).toHaveBeenCalledWith('connection_stalled', expect.any(String));
    });

    it('does not judge the link of an older server that sends no acks', () => {
      const { client, ws, h } = live();
      ws.receive(listening);
      for (let i = 0; i < 50; i++) chunk(client);
      expect(h.onError).not.toHaveBeenCalled();
    });

    it('gives up on a socket that does not open in time, so a fresh attempt can get through', () => {
      const h = handlers();
      const client = new AsrClient('ws://x/ws', h);
      client.connect();
      vi.advanceTimersByTime(1_900);
      expect(h.onError).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(h.onError).toHaveBeenCalledWith('connection_failed', expect.any(String));
      expect(FakeWebSocket.last!.readyState).toBe(FakeWebSocket.CLOSED);
    });

    it('gives up on a connection that is not ready in time, so it can be retried', () => {
      const { ws, h } = live();
      vi.advanceTimersByTime(4_900);
      expect(h.onError).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(h.onError).toHaveBeenCalledWith('connection_timeout', expect.any(String));
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    });

    it('allows a longer start-up when asked, for a slow but working recognizer', () => {
      const h = handlers();
      const client = new AsrClient('ws://x/ws', h, { readyTimeoutMs: 8_000 });
      client.connect();
      FakeWebSocket.last!.open();
      vi.advanceTimersByTime(7_900);
      expect(h.onError).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(h.onError).toHaveBeenCalledWith('connection_timeout', expect.any(String));
    });

    it('asks the server to end the session it replaces', () => {
      const client = new AsrClient('ws://x/ws', handlers(), { replaces: 'old-session' });
      client.connect();
      FakeWebSocket.last!.open();
      expect(JSON.parse(FakeWebSocket.last!.sent[0] as string).replaces).toBe('old-session');
    });

    it('measures recognition delay from interim word timings, and upload age from acks', () => {
      const { client, ws } = live();
      ws.receive(listening);
      chunk(client); // the stream starts one frame before its first chunk was sent
      ws.receive(ack(1));
      expect(client.metrics()).toMatchObject({ delayMs: null, backlogMs: 0 });
      const result = (type: string, endMs: number) => ({
        type,
        sessionId: 'sess-1',
        segmentId: 'dg-0',
        segmentOrder: 0,
        sequence: 1,
        text: 'hello',
        words: [{ text: 'hello', startMs: endMs - 300, endMs }],
      });
      vi.advanceTimersByTime(1_000);
      ws.receive(ack(1));
      // The stream started 100 ms before the first chunk; the word ended 700 ms into it, so it
      // was spoken 0.6 s ago on this clock, and is heard now, at 1.1 s: 500 ms.
      ws.receive(result('transcript.interim', 700));
      expect(client.metrics().delayMs).toBe(500);
      ws.receive(result('transcript.final', 100)); // finals may end early: not timed
      expect(client.metrics().delayMs).toBe(500);
      client.sendAudio(new ArrayBuffer(400));
      vi.advanceTimersByTime(150);
      ws.receive(ack(1)); // the newest chunk hasn't arrived yet
      expect(client.metrics().backlogMs).toBe(150);
      expect(client.sessionId).toBe('sess-1');
    });
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

  it('reports a failed connection, then closes it itself', () => {
    const h = handlers();
    const client = new AsrClient('ws://x/ws', h);
    client.connect();
    FakeWebSocket.last!.onerror?.();
    expect(h.onError).toHaveBeenCalledWith('connection_failed', expect.any(String));
    expect(h.onClose).toHaveBeenCalledWith(true);
  });

  it('reports a connection the server drops as unintentional', () => {
    const h = handlers();
    const client = new AsrClient('ws://x/ws', h);
    client.connect();
    const ws = FakeWebSocket.last!;
    ws.open();
    ws.close();
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onClose).toHaveBeenCalledWith(false);
  });
});
