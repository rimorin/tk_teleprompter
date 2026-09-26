import { describe, expect, it } from 'vitest';
import { resolveProvider } from './asrProvider';

const asr = {
  provider: 'deepgram',
  configured: true,
  encodings: ['linear16', 'opus'] as const,
  providers: [
    { name: 'deepgram', encodings: ['linear16', 'opus'] as ('linear16' | 'opus')[] },
    { name: 'assemblyai', encodings: ['linear16'] as ('linear16' | 'opus')[] },
  ],
};

describe('resolveProvider', () => {
  it('uses the saved choice when the server offers it', () => {
    expect(resolveProvider({ ...asr, encodings: [...asr.encodings] }, 'assemblyai')).toEqual({
      name: 'assemblyai',
      encodings: ['linear16'],
    });
  });

  it("falls back to the server's default when the saved choice is gone or unset", () => {
    const current = { ...asr, encodings: [...asr.encodings] };
    expect(resolveProvider(current, 'elsewhere').name).toBe('deepgram');
    expect(resolveProvider(current, null).name).toBe('deepgram');
  });

  it('names no provider for servers that offer no choice', () => {
    expect(resolveProvider({ provider: 'deepgram', configured: true }, 'assemblyai')).toEqual({
      name: undefined,
      encodings: ['linear16', 'opus'],
    });
  });
});
