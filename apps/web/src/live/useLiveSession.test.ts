import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_DELAYS_MS, useLiveSession } from './useLiveSession';

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
  listen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
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

  it('retries a failed reconnect with growing waits, then gives up', async () => {
    const { handlers, hook } = setup();
    await startListening(hook);
    act(() => lastSocket().drop());
    for (const delay of RECONNECT_DELAYS_MS) {
      await act(async () => vi.advanceTimersByTime(delay));
      act(() => lastSocket().drop()); // the server is still unreachable
    }
    expect(sockets()).toHaveLength(1 + RECONNECT_DELAYS_MS.length);
    expect(hook.result.current.phase).toBe('off');
    expect(hook.result.current.error).toMatch(/lost connection/i);
    expect(handlers.onInterrupted).toHaveBeenCalledTimes(1);
    expect(mic.stop).toHaveBeenCalled();
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

  it('a connection that fails before the microphone is up ends the start', async () => {
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
    expect(await result!).toBe('failed');
    expect(handlers.onInterrupted).toHaveBeenCalledTimes(1);
    expect(mic.stop).toHaveBeenCalled();
    expect(sockets()).toHaveLength(1);
  });
});
