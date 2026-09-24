import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickAudioFormat } from './micCapture';

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
});
