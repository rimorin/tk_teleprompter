import { useCallback, useEffect, useRef, useState } from 'react';
import { ERROR_MESSAGES, type TranscriptEvent } from '@teleprompter/shared';
import { MicError, startMicCapture, type MicCapture } from '../audio/micCapture';
import { AsrClient } from '../net/asrClient';
import { endpoints } from '../net/endpoints';
import { fetchHealth } from '../net/health';
import { loadAccessCode, saveAccessCode } from './accessCode';

type LivePhase = 'off' | 'starting' | 'connecting' | 'listening' | 'stopping';

type Handlers = {
  onListening: () => void;
  onTranscript: (event: TranscriptEvent) => void;
  /** The session ended without the user stopping it (error or dropped connection). */
  onInterrupted: () => void;
  /** The user stopped the session. */
  onStopped: () => void;
  /** The server needs an access code (none saved, or the saved one was rejected). */
  onNeedsAccessCode: (rejected: boolean) => void;
};

type StartResult = 'started' | 'failed' | 'needs_code';

/** Microphone + transcription session lifecycle. Manual control never depends on it. */
export function useLiveSession(handlers: Handlers) {
  const [phase, setPhase] = useState<LivePhase>('off');
  const [error, setError] = useState<string | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const clientRef = useRef<AsrClient | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const teardown = useCallback(() => {
    const mic = micRef.current;
    micRef.current = null;
    void mic?.stop();
    clientRef.current?.close();
    clientRef.current = null;
  }, []);

  const interrupt = useCallback(
    (message: string) => {
      teardown();
      setError(message);
      setPhase('off');
      handlersRef.current.onInterrupted();
    },
    [teardown],
  );

  /** Resolves 'failed' (error is set) or 'needs_code' if it could not start. */
  const start = useCallback(async (): Promise<StartResult> => {
    if (micRef.current || clientRef.current) return 'failed';
    setError(null);
    setPhase('starting');
    const health = await fetchHealth();
    const configError = !health
      ? 'Could not reach the tracking server. Manual mode still works.'
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
    let client: AsrClient | null = null;
    try {
      micRef.current = await startMicCapture({
        onChunk: (pcm) => client?.sendAudio(pcm),
        onEnded: () =>
          interrupt('The microphone stopped (was it disconnected?). Manual control still works.'),
      });
    } catch (err) {
      setError(err instanceof MicError ? err.message : 'The microphone could not be started.');
      setPhase('off');
      return 'failed';
    }
    setPhase('connecting');
    client = new AsrClient(
      endpoints.sessionUrl,
      {
        onStatus: (status) => {
          if (status === 'listening') {
            setPhase('listening');
            handlersRef.current.onListening();
          }
        },
        onTranscript: (ev) => handlersRef.current.onTranscript(ev),
        onError: (code, message) => {
          if (code === 'access_denied') {
            saveAccessCode('');
            teardown();
            setPhase('off');
            handlersRef.current.onInterrupted();
            handlersRef.current.onNeedsAccessCode(true);
            return;
          }
          interrupt(message);
        },
        onClose: (intentional) => {
          if (!intentional && clientRef.current === client) {
            interrupt('Lost connection to the tracking server. Manual control still works.');
          }
        },
      },
      { accessCode: accessCode || undefined },
    );
    clientRef.current = client;
    client.connect();
    return 'started';
  }, [interrupt, teardown]);

  const stop = useCallback(async () => {
    const client = clientRef.current;
    if (!client && !micRef.current) return;
    setPhase('stopping');
    const mic = micRef.current;
    micRef.current = null;
    await mic?.stop();
    clientRef.current = null;
    await client?.stop();
    setPhase('off');
    handlersRef.current.onStopped();
  }, []);

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
