import { useCallback, useEffect, useRef, useState } from 'react';
import { ERROR_MESSAGES, type AudioFormat, type TranscriptEvent } from '@teleprompter/shared';
import { MicError, pickAudioFormat, startMicCapture, type MicCapture } from '../audio/micCapture';
import { AsrClient, type AsrClientHandlers, type AsrMetrics } from '../net/asrClient';
import { endpoints } from '../net/endpoints';
import { fetchHealth } from '../net/health';
import { loadAccessCode, saveAccessCode } from './accessCode';

type LivePhase = 'off' | 'starting' | 'connecting' | 'listening' | 'reconnecting' | 'stopping';

type Handlers = {
  onListening: () => void;
  onTranscript: (event: TranscriptEvent) => void;
  /** The connection dropped; the microphone stays on while a new session is attempted. */
  onReconnecting: () => void;
  /** The session ended without the user stopping it (error or dropped connection). */
  onInterrupted: () => void;
  /** The user stopped the session. */
  onStopped: () => void;
  /** The server needs an access code (none saved, or the saved one was rejected). */
  onNeedsAccessCode: (rejected: boolean) => void;
};

type StartResult = 'started' | 'failed' | 'needs_code';

type ClientErrorCode = Parameters<AsrClientHandlers['onError']>[0];

/** Failures that can clear up by themselves. Others (bad code, time limit…) end the session. */
const RETRYABLE: ReadonlySet<ClientErrorCode> = new Set<ClientErrorCode>([
  'connection_failed',
  'connection_timeout',
  'connection_stalled',
  'asr_unavailable',
  'server_busy',
  'server_restarting',
  'internal',
]);

/**
 * Waits before the first reconnect attempts, then RETRY_EVERY_MS for as long as the microphone
 * is on. Outages are usually seconds long, so retry quickly and never give up; each attempt is
 * cheap (it fails fast while there is no network). Resets once listening again.
 */
export const RECONNECT_DELAYS_MS = [0, 500, 1_000];
export const RETRY_EVERY_MS = 2_000;
/** Waits after each "busy" in a row (server full or provider rate limit): back off, don't hammer. */
export const BUSY_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000];
/**
 * Time allowed to become ready, by how many attempts in a row ran out of time: short at first
 * (a hung attempt is best retried), longer when the recognizer is slow but working.
 */
export const READY_TIMEOUTS_MS = [5_000, 8_000, 12_000];

/** Microphone + transcription session lifecycle. Manual control never depends on it. */
export function useLiveSession(handlers: Handlers) {
  const [phase, setPhase] = useState<LivePhase>('off');
  const [error, setError] = useState<string | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const clientRef = useRef<AsrClient | null>(null);
  const retryRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    attempt: number;
    /** Attempts in a row that ran out of time becoming ready. */
    timeouts: number;
    /** "Busy" answers in a row. */
    busy: number;
  }>({ timer: null, attempt: 0, timeouts: 0, busy: 0 });
  /** Settings reused by every connection of one microphone session; null when there is none. */
  const sessionRef = useRef<{ format: AudioFormat; accessCode: string } | null>(null);
  /** Server id of the connection being replaced, so the server can end it at once. */
  const replacesRef = useRef<string | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const cancelRetry = useCallback(() => {
    const retry = retryRef.current;
    if (retry.timer) clearTimeout(retry.timer);
    retry.timer = null;
    retry.attempt = 0;
    retry.timeouts = 0;
    retry.busy = 0;
  }, []);

  const teardown = useCallback(() => {
    cancelRetry();
    sessionRef.current = null;
    replacesRef.current = null;
    const mic = micRef.current;
    micRef.current = null;
    void mic?.stop();
    clientRef.current?.close();
    clientRef.current = null;
  }, [cancelRetry]);

  const interrupt = useCallback(
    (message: string) => {
      teardown();
      setError(message);
      setPhase('off');
      handlersRef.current.onInterrupted();
    },
    [teardown],
  );

  // openClient and lostConnection call each other, so openClient is reached through a ref.
  const openClientRef = useRef<() => void>(() => {});

  /** The connection failed or stalled: start a fresh one while the microphone keeps running. */
  const lostConnection = useCallback(() => {
    const client = clientRef.current;
    clientRef.current = null;
    replacesRef.current = client?.sessionId ?? replacesRef.current;
    client?.close();
    const retry = retryRef.current;
    if (!sessionRef.current || retry.timer) return;
    const delay = retry.busy
      ? BUSY_BACKOFF_MS[Math.min(retry.busy, BUSY_BACKOFF_MS.length) - 1]!
      : (RECONNECT_DELAYS_MS[retry.attempt] ?? RETRY_EVERY_MS);
    retry.attempt++;
    setPhase('reconnecting');
    handlersRef.current.onReconnecting();
    retry.timer = setTimeout(() => {
      retry.timer = null;
      openClientRef.current();
    }, delay);
  }, []);

  // The phone's own view of the network: act on it at once instead of waiting for timeouts.
  useEffect(() => {
    const onOffline = () => {
      if (clientRef.current) lostConnection();
    };
    const onOnline = () => {
      const retry = retryRef.current;
      const stuck = clientRef.current && !clientRef.current.isLive;
      if (!retry.timer && !stuck) return;
      // Retry now: bring a scheduled attempt forward, or replace one begun while offline.
      if (retry.timer) clearTimeout(retry.timer);
      retry.timer = null;
      const attempt = clientRef.current;
      clientRef.current = null;
      attempt?.close();
      openClientRef.current();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [lostConnection]);

  useEffect(() => {
    openClientRef.current = () => {
      const session = sessionRef.current!;
      const client: AsrClient = new AsrClient(
        endpoints.sessionUrl,
        {
          onStatus: (status) => {
            if (status !== 'listening' || clientRef.current !== client) return;
            retryRef.current.attempt = 0;
            retryRef.current.timeouts = 0;
            retryRef.current.busy = 0;
            setPhase('listening');
            handlersRef.current.onListening();
          },
          onTranscript: (ev) => {
            if (clientRef.current === client) handlersRef.current.onTranscript(ev);
          },
          onError: (code, message) => {
            if (clientRef.current !== client) return;
            if (code === 'access_denied') {
              saveAccessCode('');
              teardown();
              setPhase('off');
              handlersRef.current.onInterrupted();
              handlersRef.current.onNeedsAccessCode(true);
              return;
            }
            if (code === 'connection_timeout') retryRef.current.timeouts++;
            if (code === 'server_busy') retryRef.current.busy++;
            if (RETRYABLE.has(code)) lostConnection();
            else interrupt(message);
          },
          onClose: (intentional) => {
            if (!intentional && clientRef.current === client) lostConnection();
          },
          onStaleStart: () => micRef.current?.restart(),
        },
        {
          accessCode: session.accessCode || undefined,
          audio: session.format,
          replaces: replacesRef.current ?? undefined,
          readyTimeoutMs:
            READY_TIMEOUTS_MS[Math.min(retryRef.current.timeouts, READY_TIMEOUTS_MS.length - 1)],
        },
      );
      clientRef.current = client;
      // A new session needs a fresh audio stream (for Opus, a new container header).
      micRef.current?.restart();
      // The client holds audio until the recognizer is listening.
      client.connect();
    };
  });

  /** Resolves 'failed' (error is set) or 'needs_code' if it could not start. */
  const start = useCallback(async (): Promise<StartResult> => {
    if (micRef.current || clientRef.current) return 'failed';
    setError(null);
    setPhase('starting');
    const health = await fetchHealth();
    if (!health || !health.asr.configured) {
      setError(
        health
          ? ERROR_MESSAGES.asr_not_configured
          : 'Could not reach the server. The buttons still work.',
      );
      setPhase('off');
      return 'failed';
    }
    const accessCode = loadAccessCode();
    if (health.access.codeRequired && !accessCode) {
      setPhase('off');
      handlersRef.current.onNeedsAccessCode(false);
      return 'needs_code';
    }
    const format = pickAudioFormat();
    const session = { format, accessCode };
    sessionRef.current = session;
    // Connect while the microphone starts.
    openClientRef.current();
    let mic: MicCapture;
    try {
      mic = await startMicCapture({
        format,
        onChunk: (chunk) => clientRef.current?.sendAudio(chunk),
        onEnded: () =>
          interrupt('The microphone stopped (was it disconnected?). The buttons still work.'),
      });
    } catch (err) {
      if (sessionRef.current === session) {
        teardown();
        setError(err instanceof MicError ? err.message : 'The microphone could not be started.');
        setPhase('off');
      }
      return 'failed';
    }
    // The session may have ended (error, stop, unmount) while the microphone was starting.
    if (sessionRef.current !== session) {
      void mic.stop();
      return 'failed';
    }
    micRef.current = mic;
    setPhase((p) => (p === 'starting' ? 'connecting' : p));
    return 'started';
  }, [interrupt, teardown]);

  const stop = useCallback(async () => {
    const client = clientRef.current;
    if (!client && !micRef.current) return;
    setPhase('stopping');
    cancelRetry();
    sessionRef.current = null;
    replacesRef.current = null;
    const mic = micRef.current;
    micRef.current = null;
    await mic?.stop();
    clientRef.current = null;
    await client?.stop();
    setPhase('off');
    handlersRef.current.onStopped();
  }, [cancelRetry]);

  /** Live timing for Diagnostics, or null when no session is connected. Stable across renders. */
  const getMetrics = useCallback((): AsrMetrics | null => clientRef.current?.metrics() ?? null, []);

  // Release the microphone and socket when the presenter unmounts.
  useEffect(() => teardown, [teardown]);

  return {
    phase,
    error,
    getMetrics,
    clearError: () => setError(null),
    start,
    stop,
  };
}
