import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicError, pickAudioFormat, startMicCapture } from './micCapture';

afterEach(() => vi.unstubAllGlobals());

const stubRecorder = (supported: string[]) =>
  vi.stubGlobal('MediaRecorder', { isTypeSupported: (t: string) => supported.includes(t) });

const PCM = { encoding: 'linear16', sampleRate: 16000, channels: 1 };
const ALL = ['linear16', 'opus', 'opus_packets'] as const;
/** WebCodecs with (or without) Opus support. */
const stubEncoder = (supported: boolean) => {
  vi.stubGlobal('AudioEncoder', { isConfigSupported: async () => ({ supported }) });
  vi.stubGlobal('AudioData', class {});
};

describe('pickAudioFormat', () => {
  it("prefers Opus packets from the browser's encoder when the provider takes them", async () => {
    stubEncoder(true);
    stubRecorder(['audio/webm;codecs=opus']);
    expect(await pickAudioFormat(ALL)).toEqual({
      encoding: 'opus_packets',
      sampleRate: 16000,
      channels: 1,
    });
    // A provider that doesn't take packets gets MediaRecorder's Opus.
    expect(await pickAudioFormat(['linear16', 'opus'])).toEqual({
      encoding: 'opus',
      container: 'webm',
    });
  });

  it('prefers recorded Opus in WebM, then Ogg, without an Opus encoder', async () => {
    stubEncoder(false);
    stubRecorder(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus']);
    expect(await pickAudioFormat(ALL)).toEqual({ encoding: 'opus', container: 'webm' });
    stubRecorder(['audio/ogg;codecs=opus']);
    expect(await pickAudioFormat(ALL)).toEqual({ encoding: 'opus', container: 'ogg' });
  });

  it('falls back to 16 kHz PCM without Opus (e.g. older Safari)', async () => {
    vi.stubGlobal('AudioEncoder', undefined);
    stubRecorder(['audio/mp4']);
    expect(await pickAudioFormat(ALL)).toEqual(PCM);
    vi.stubGlobal('MediaRecorder', undefined);
    expect(await pickAudioFormat(ALL)).toEqual(PCM);
  });

  it('uses PCM when the provider takes nothing else', async () => {
    stubEncoder(true);
    stubRecorder(['audio/webm;codecs=opus']);
    expect(await pickAudioFormat(['linear16'])).toEqual(PCM);
  });
});

describe('startMicCapture', () => {
  it('asks for unprocessed audio: no noise suppression or echo cancellation, auto gain on', async () => {
    let asked: MediaStreamConstraints | undefined;
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async (c: MediaStreamConstraints) => {
          asked = c;
          throw new DOMException('denied', 'NotAllowedError');
        },
      },
    });
    await expect(
      startMicCapture({
        format: { encoding: 'opus', container: 'webm' },
        onChunk: () => {},
        onEnded: () => {},
      }),
    ).rejects.toBeInstanceOf(MicError);
    expect(asked?.audio).toMatchObject({
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: true,
    });
  });
});
