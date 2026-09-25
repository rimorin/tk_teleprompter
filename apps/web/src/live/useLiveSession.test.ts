import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  READY_TIMEOUTS_MS,
  BUSY_BACKOFF_MS,
  RECONNECT_DELAYS_MS,
  RETRY_EVERY_MS,
  useLiveSession,
} from './useLiveSession';

const mic = { stop: vi.fn(async () => {}), restart: vi.fn() };

vi.mock('../audio/micCapture', () => ({
  MicError: class extends Error {},
  pickAudioFormat: () => ({ encoding: 'opus', container: 'webm' }),
  startMicCapture: vi.fn(async () => mic),
}));
vi.mock('../net/health', () => ({
  fetchHealth: async () => ({
    ok: true,
    protocolVersion: 1,
    asr: { provider: 'deepgram', configured: true },
    access: { codeRequired: false },
  }),
}));

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType = 'blob';
  sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.all.push(this);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  addEventListener() {}
  // Test helpers
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  listen() {
    this.open();
    this.receive({ type: 'session.status', status: 'listening', sessionId: 's' });
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** The network dropped: closed without anyone asking. */
  drop() {
    this.close();
  }
}

const sockets = () => FakeWebSocket.all;
const lastSocket = () => FakeWebSocket.all.at(-1)!;

function setup() {
  const handlers = {
    onListening: vi.fn(),
    onTranscript: vi.fn(),
    onReconnecting: vi.fn(),
    onInterrupted: vi.fn(),
    onStopped: vi.fn(),
    onNeedsAccessCode: vi.fn(),
  };
  const hook = renderHook(() => useLiveSession(handlers));
  return { handlers, hook };
}

async function startListening(hook: ReturnType<typeof setup>['hook']) {
  await act(async () => {
    await hook.result.current.start();
  });
  act(() => lastSocket().listen());
  expect(hook.result.current.phase).toBe('listening');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  FakeWebSocket.all = [];
  mic.stop.mockClear();
  mic.restart.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useLiveSession reconnect', () => {
  it('reconnects after a dropped connection, keeping the microphone on', async () => {
    const { handlers, hook } = setup();
    await startListening(hook);

    act(() => lastSocket().drop());
    expect(hook.result.current.phase).toBe('reconnecting');
    expect(handlers.onReconnecting).toHaveBeenCalledTimes(1);
    expect(handlers.onInterrupted).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!));
    expect(sockets()).toHaveLength(2);
    // Fresh audio stream (new Opus header) for the new session.
    expect(mic.restart).toHaveBeenCalledTimes(1);
    act(() => lastSocket().listen());
    expect(hook.result.current.phase).toBe('listening');
    expect(handlers.onListening).toHaveBeenCalledTimes(2);
    expect(mic.stop).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBeNull();
  });

  it('keeps retrying while the microphone is on: quickly at first, then steadily', async () => {
    const { handlers, hook } = setup();
    await startListening(hook);
    act(() => lastSocket().drop());
    const waits = [...RECONNECT_DELAYS_MS, RETRY_EVERY_MS, RETRY_EVERY_MS, RETRY_EVERY_MS];
    for (const wait of waits) {
      await act(async () => vi.advanceTimersByTime(wait));
      act(() => lastSocket().drop()); // the network is still down
    }
    expect(sockets()).toHaveLength(1 + waits.length);
    expect(hook.result.current.phase).toBe('reconnecting');
    expect(handlers.onInterrupted).not.toHaveBeenCalled();
    expect(mic.stop).not.toHaveBeenCalled();
    // When the network is back, the next attempt succeeds.
    await act(async () => vi.advanceTimersByTime(RETRY_EVERY_MS));
    act(() => lastSocket().listen());
    expect(hook.result.current.phase).toBe('listening');
  });

  it('replaces a connection attempt begun while offline as soon as the phone is back online', async () => {
    const { hook } = setup();
    await startListening(hook);
    act(() => void window.dispatchEvent(new Event('offline')));
    await act(async () => vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!)); // an attempt starts…
    const stuck = lastSocket(); // …and hangs, as it would in a dead zone
    act(() => void window.dispatchEvent(new Event('online')));
    expect(stuck.readyState).toBe(FakeWebSocket.CLOSED);
    expect(lastSocket()).not.toBe(stuck);
    act(() => lastSocket().listen());
    expect(hook.result.current.phase).toBe('listening');
  });

  it('gives a slow recognizer longer to start after an attempt ran out of time', async () => {
    const { hook } = setup();
    await startListening(hook);
    act(() => lastSocket().drop());
    await act(async () => vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!));
    act(() => lastSocket().open()); // opens, but the recognizer is slow to start
    await act(async () => vi.advanceTimersByTime(READY_TIMEOUTS_MS[0]!));
    expect(lastSocket().readyState).toBe(FakeWebSocket.CLOSED); // ran out of time: retried
    await act(async () => vi.advanceTimersByTime(RECONNECT_DELAYS_MS[1]!));
    const slow = lastSocket();
    act(() => slow.open());
    await act(async () => vi.advanceTimersByTime(READY_TIMEOUTS_MS[0]! + 1_000));
    expect(slow.readyState).toBe(FakeWebSocket.OPEN); // this time it is given longer…
    act(() => slow.receive({ type: 'session.status', status: 'listening', sessionId: 's2' }));
    expect(hook.result.current.phase).toBe('listening'); // …and gets there
  });

  it('tells the server which session a reconnect replaces', async () => {
    const { hook } = setup();
    await startListening(hook);
    act(() => lastSocket().drop());
    await act(async () => vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!));
    act(() => lastSocket().open());
    expect(JSON.parse(lastSocket().sent[0] as string).replaces).toBe('s');
  });

  it('acts on the phone going offline and online at once', async () => {
    const { hook } = setup();
    await startListening(hook);
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(hook.result.current.phase).toBe('reconnecting');
    expect(sockets()[0]!.readyState).toBe(FakeWebSocket.CLOSED);
    // The first retry fails while offline; the next one waits…
    await act(async () => vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!));
    act(() => lastSocket().drop());
    const before = sockets().length;
    // …until the phone reports the network is back, which retries immediately.
    act(() => void window.dispatchEvent(new Event('online')));
    expect(sockets()).toHaveLength(before + 1);
    act(() => lastSocket().listen());
    expect(hook.result.current.phase).toBe('listening');
  });

  it('starts counting again once listening, so later drops get the full set of retries', async () => {
    const { hook } = setup();
    await startListening(hook);
    for (let round = 0; round < 3; round++) {
      act(() => lastSocket().drop());
      await act(async () => vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!));
      act(() => lastSocket().listen());
    }
    expect(hook.result.current.phase).toBe('listening');
  });

  it('retries a provider outage, but not the session time limit', async () => {
    const { handlers, hook } = setup();
    await startListening(hook);
    act(() =>
      lastSocket().receive({ type: 'session.error', code: 'asr_unavailable', message: 'x' }),
    );
    expect(hook.result.current.phase).toBe('reconnecting');
    await act(async () => vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!));
    act(() => lastSocket().listen());

    const msg = 'The voice session reached its time limit.';
    act(() =>
      lastSocket().receive({ type: 'session.error', code: 'session_time_limit', message: msg }),
    );
    expect(hook.result.current.phase).toBe('off');
    expect(hook.result.current.error).toBe(msg);
    expect(handlers.onInterrupted).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(sockets()).toHaveLength(2);
  });

  it('backs off while busy (server full or provider rate limit), then resets once listening', async () => {
    const { hook } = setup();
    await startListening(hook);
    const busy = () =>
      act(() => lastSocket().receive({ type: 'session.error', code: 'server_busy', message: 'x' }));
    for (const wait of [...BUSY_BACKOFF_MS, BUSY_BACKOFF_MS.at(-1)!]) {
      busy();
      const count = sockets().length;
      await act(async () => vi.advanceTimersByTime(wait - 1));
      expect(sockets()).toHaveLength(count); // not yet
      await act(async () => vi.advanceTimersByTime(1));
      expect(sockets()).toHaveLength(count + 1);
    }
    act(() => lastSocket().listen());
    act(() => lastSocket().drop());
    await act(async () => vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!));
    expect(hook.result.current.phase).toBe('reconnecting'); // quick retries again
    expect(sockets().length).toBe(BUSY_BACKOFF_MS.length + 3);
  });

  it('stops without retrying when the provider refuses the session', async () => {
    const { handlers, hook } = setup();
    await startListening(hook);
    const msg = 'The speech provider refused this session.';
    act(() => lastSocket().receive({ type: 'session.error', code: 'asr_error', message: msg }));
    expect(hook.result.current.phase).toBe('off');
    expect(hook.result.current.error).toBe(msg);
    expect(handlers.onInterrupted).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(sockets()).toHaveLength(1);
  });

  it('stopping while reconnecting cancels the retry', async () => {
    const { handlers, hook } = setup();
    await startListening(hook);
    act(() => lastSocket().drop());
    await act(async () => {
      await hook.result.current.stop();
    });
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(sockets()).toHaveLength(1);
    expect(hook.result.current.phase).toBe('off');
    expect(handlers.onStopped).toHaveBeenCalledTimes(1);
    expect(mic.stop).toHaveBeenCalled();
  });

  it('a connection that fails before the microphone is up is retried, and the start succeeds', async () => {
    const { handlers, hook } = setup();
    let finishMic!: () => void;
    const { startMicCapture } = await import('../audio/micCapture');
    vi.mocked(startMicCapture).mockImplementationOnce(
      () => new Promise((resolve) => (finishMic = () => resolve(mic))),
    );
    let result: Promise<string>;
    await act(async () => {
      result = hook.result.current.start();
    });
    act(() => lastSocket().drop());
    await act(async () => finishMic());
    expect(await result!).toBe('started');
    await act(async () => vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]!));
    act(() => lastSocket().listen());
    expect(hook.result.current.phase).toBe('listening');
    expect(handlers.onInterrupted).not.toHaveBeenCalled();
    expect(mic.stop).not.toHaveBeenCalled();
  });
});
