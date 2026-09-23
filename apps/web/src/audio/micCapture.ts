import { AUDIO_FRAME_MS, AUDIO_SAMPLE_RATE } from '@teleprompter/shared';
import workletUrl from './pcm-worklet.ts?worker&url';

type MicErrorCode =
  | 'insecure_context'
  | 'permission_denied'
  | 'no_device'
  | 'device_busy'
  | 'unsupported'
  | 'mic_error';

const MIC_ERROR_MESSAGES: Record<MicErrorCode, string> = {
  insecure_context: 'The microphone needs a secure page (https:// or localhost).',
  permission_denied:
    'Microphone access was denied. Allow it in the browser’s site settings to use voice tracking.',
  no_device: 'No microphone was found. Connect one and try again.',
  device_busy: 'The microphone is in use by another application or cannot be opened.',
  unsupported: 'This browser does not support the audio features voice tracking needs.',
  mic_error: 'The microphone could not be started.',
};

export class MicError extends Error {
  constructor(readonly code: MicErrorCode) {
    super(MIC_ERROR_MESSAGES[code]);
  }
}

export type MicCapture = { stop: () => Promise<void> };

type Handlers = {
  /** One 100 ms frame of mono 16 kHz PCM16 (little-endian). */
  onChunk: (pcm: ArrayBuffer) => void;
  /** The device went away (unplugged, permission revoked). Capture has stopped. */
  onEnded: () => void;
};

function toMicError(err: unknown): MicError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError')
    return new MicError('permission_denied');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new MicError('no_device');
  if (name === 'NotReadableError' || name === 'AbortError') return new MicError('device_busy');
  if (name === 'SecurityError') return new MicError('insecure_context');
  return new MicError('mic_error');
}

/**
 * Start capturing the microphone. Must be called from a user gesture. Audio runs through an
 * AudioWorklet that downmixes and resamples from the device rate to 16 kHz PCM16.
 */
export async function startMicCapture({ onChunk, onEnded }: Handlers): Promise<MicCapture> {
  if (!window.isSecureContext) throw new MicError('insecure_context');
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
    throw new MicError('unsupported');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    throw toMicError(err);
  }

  const ctx = new AudioContext();
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const track of stream.getTracks()) track.stop();
    await ctx.close().catch(() => {});
  };

  try {
    await ctx.audioWorklet.addModule(workletUrl);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCountMode: 'explicit',
      channelCount: 1,
      processorOptions: {
        targetRate: AUDIO_SAMPLE_RATE,
        frameSamples: (AUDIO_SAMPLE_RATE * AUDIO_FRAME_MS) / 1000,
      },
    });
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (!stopped) onChunk(e.data);
    };
    // Some browsers only pull audio through nodes connected to the destination; mute it.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);
    // Safari may start suspended or suspend on interruption; resume when possible.
    ctx.onstatechange = () => {
      if (!stopped && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    };
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    await stop();
    throw new MicError('unsupported');
  }

  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      if (stopped) return;
      void stop();
      onEnded();
    });
  }
  return { stop };
}
