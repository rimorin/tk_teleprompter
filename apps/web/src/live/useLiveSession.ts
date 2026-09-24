import { useCallback, useEffect, useRef, useState } from 'react';
import { ERROR_MESSAGES, type AudioFormat, type TranscriptEvent } from '@teleprompter/shared';
import { MicError, pickAudioFormat, startMicCapture, type MicCapture } from '../audio/micCapture';
import { AsrClient, type AsrClientHandlers } from '../net/asrClient';
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
  'network_slow',
  'asr_unavailable',
  'asr_error',
  'server_busy',
  'server_restarting',
  'internal',
]);

/** Wait before each reconnect attempt (about 40 s in all); resets once listening again. */
export const RECONNECT_DELAYS_MS = [0, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 8_000];

const LOST_CONNECTION = 'Lost connection to the server. The buttons still work.';

/** Microphone + transcription session lifecycle. Manual control never depends on it. */
export function useLiveSession(handlers: Handlers) {
  const [phase, setPhase] = useState<LivePhase>('off');
  const [error, setError] = useState<string | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const clientRef = useRef<AsrClient | null>(null);
  const retryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; attempt: number }>({
    timer: null,
    attempt: 0,
  });
  /** Settings reused by every connection of one microphone session. */
  const sessionRef = useRef<{ format: AudioFormat; accessCode: string } | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const cancelRetry = useCallback(() => {
    const retry = retryRef.current;
    if (retry.timer) clearTimeout(retry.timer);
    retry.timer = null;
    retry.attempt = 0;
  }, []);

  const teardown = useCallback(() => {
    cancelRetry();
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

  /** The connection failed: try a new session while the microphone keeps running. */
  const lostConnection = useCallback(
    (message: string) => {
      const client = clientRef.current;
      clientRef.current = null;
      client?.close();
      const retry = retryRef.current;
      const delay = RECONNECT_DELAYS_MS[retry.attempt];
      // Before the microphone is up there is nothing to keep going, so the start fails.
      if (!micRef.current || delay === undefined) return interrupt(message);
      retry.attempt++;
      setPhase('reconnecting');
      handlersRef.current.onReconnecting();
      retry.timer = setTimeout(() => {
        retry.timer = null;
        openClientRef.current();
      }, delay);
    },
    [interrupt],
  );

  useEffect(() => {
    openClientRef.current = () => {
      const session = sessionRef.current!;
      const client: AsrClient = new AsrClient(
        endpoints.sessionUrl,
        {
          onStatus: (status) => {
            if (status !== 'listening' || clientRef.current !== client) return;
            retryRef.current.attempt = 0;
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
            if (RETRYABLE.has(code)) lostConnection(message);
            else interrupt(message);
          },
          onClose: (intentional) => {
            if (!intentional && clientRef.current === client) lostConnection(LOST_CONNECTION);
          },
        },
        { accessCode: session.accessCode || undefined, audio: session.format },
      );
      clientRef.current = client;
      // A new session needs a fresh audio stream (for Opus, a new container header).
      micRef.current?.restart();
      // The client holds audio until the socket opens.
      client.connect();
    };
  });

  /** Resolves 'failed' (error is set) or 'needs_code' if it could not start. */
  const start = useCallback(async (): Promise<StartResult> => {
    if (micRef.current || clientRef.current) return 'failed';
    setError(null);
    setPhase('starting');
    const health = await fetchHealth();
    const configError = !health
      ? 'Could not reach the server. The buttons still work.'
      : !health.asr.configured
        ? ERROR_MESSAGES.asr_not_configured
        : null;
    if (configError) {
      setError(configError);
      setPhase('off');
      return 'failed';
    }
    const accessCode = loadAccessCode();
    if (health!.access.codeRequired && !accessCode) {
      setPhase('off');
      handlersRef.current.onNeedsAccessCode(false);
      return 'needs_code';
    }
    const format = pickAudioFormat();
    sessionRef.current = { format, accessCode };
    // Connect while the microphone starts.
    openClientRef.current();
    const client = clientRef.current;
    let mic: MicCapture;
    try {
      mic = await startMicCapture({
        format,
        onChunk: (chunk) => clientRef.current?.sendAudio(chunk),
        onEnded: () =>
          interrupt('The microphone stopped (was it disconnected?). The buttons still work.'),
      });
    } catch (err) {
      if (clientRef.current === client) {
        teardown();
        setError(err instanceof MicError ? err.message : 'The microphone could not be started.');
        setPhase('off');
      }
      return 'failed';
    }
    // The session may have ended (error, stop, unmount) while the microphone was starting.
    if (clientRef.current !== client) {
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
    const mic = micRef.current;
    micRef.current = null;
    await mic?.stop();
    clientRef.current = null;
    await client?.stop();
    setPhase('off');
    handlersRef.current.onStopped();
  }, [cancelRetry]);

  // Release the microphone and socket when the presenter unmounts.
  useEffect(() => teardown, [teardown]);

  return {
    phase,
    error,
    clearError: () => setError(null),
    start,
    stop,
  };
}
