import {
  AUDIO_FRAME_MS,
  AUDIO_SAMPLE_RATE,
  OPUS_BITS_PER_SECOND,
  type AudioFormat,
} from '@teleprompter/shared';
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

const OPUS_TYPES = [
  { mimeType: 'audio/webm;codecs=opus', container: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', container: 'ogg' },
] as const;

/**
 * The format to capture in: Opus (about 8x less upload than PCM, which matters on mobile data)
 * when the browser can record it, otherwise 16 kHz PCM.
 */
export function pickAudioFormat(): AudioFormat {
  if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
    const opus = OPUS_TYPES.find((t) => MediaRecorder.isTypeSupported(t.mimeType));
    if (opus) return { encoding: 'opus', container: opus.container };
  }
  return { encoding: 'linear16', sampleRate: AUDIO_SAMPLE_RATE, channels: 1 };
}

type Handlers = {
  format: AudioFormat;
  /** One ~100 ms chunk: mono 16 kHz PCM16 (little-endian), or the next piece of the Opus stream. */
  onChunk: (chunk: ArrayBuffer) => void;
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
 * Start capturing the microphone in `format` (see pickAudioFormat). Must be called from a user
 * gesture.
 */
export async function startMicCapture({ format, onChunk, onEnded }: Handlers): Promise<MicCapture> {
  if (!window.isSecureContext) throw new MicError('insecure_context');
  if (
    !navigator.mediaDevices?.getUserMedia ||
    (format.encoding === 'linear16' && typeof AudioWorkletNode === 'undefined')
  ) {
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

  const capture =
    format.encoding === 'linear16'
      ? await startPcm(stream, onChunk)
      : startOpus(stream, format.container, onChunk);
  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      void capture.stop();
      onEnded();
    });
  }
  return capture;
}

/** Records Opus with MediaRecorder; chunks are delivered strictly in order. */
function startOpus(
  stream: MediaStream,
  container: 'webm' | 'ogg',
  onChunk: (chunk: ArrayBuffer) => void,
): MicCapture {
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: OPUS_TYPES.find((t) => t.container === container)!.mimeType,
      audioBitsPerSecond: OPUS_BITS_PER_SECOND,
    });
  } catch {
    for (const track of stream.getTracks()) track.stop();
    throw new MicError('unsupported');
  }
  // Blob.arrayBuffer() is async: chain reads so chunks can't overtake each other.
  let delivered = Promise.resolve();
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    delivered = delivered.then(() => e.data.arrayBuffer()).then(onChunk, () => {});
  };
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start(AUDIO_FRAME_MS);
  let stopping: Promise<void> | null = null;
  const stop = () => {
    // Stopping flushes a last chunk; wait for it so the final words are sent.
    stopping ??= (async () => {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      await delivered;
      for (const track of stream.getTracks()) track.stop();
    })();
    return stopping;
  };
  return { stop };
}

/** Captures through an AudioWorklet that downmixes and resamples to 16 kHz PCM16. */
async function startPcm(
  stream: MediaStream,
  onChunk: (chunk: ArrayBuffer) => void,
): Promise<MicCapture> {
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
  return { stop };
}
