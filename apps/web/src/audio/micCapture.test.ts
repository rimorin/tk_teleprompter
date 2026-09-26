import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicError, pickAudioFormat, startMicCapture } from './micCapture';

afterEach(() => vi.unstubAllGlobals());

const stubRecorder = (supported: string[]) =>
  vi.stubGlobal('MediaRecorder', { isTypeSupported: (t: string) => supported.includes(t) });

describe('pickAudioFormat', () => {
  it('prefers Opus in WebM, then Ogg', () => {
    stubRecorder(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus']);
    expect(pickAudioFormat()).toEqual({ encoding: 'opus', container: 'webm' });
    stubRecorder(['audio/ogg;codecs=opus']);
    expect(pickAudioFormat()).toEqual({ encoding: 'opus', container: 'ogg' });
  });

  it('falls back to 16 kHz PCM without Opus recording (e.g. older Safari)', () => {
    stubRecorder(['audio/mp4']);
    expect(pickAudioFormat()).toEqual({ encoding: 'linear16', sampleRate: 16000, channels: 1 });
    vi.stubGlobal('MediaRecorder', undefined);
    expect(pickAudioFormat()).toEqual({ encoding: 'linear16', sampleRate: 16000, channels: 1 });
  });

  it('uses PCM when the server does not accept Opus', () => {
    stubRecorder(['audio/webm;codecs=opus']);
    expect(pickAudioFormat(false)).toEqual({
      encoding: 'linear16',
      sampleRate: 16000,
      channels: 1,
    });
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
