import { describe, expect, it } from 'vitest';
import { resolveProvider, type OfferedProvider } from './asrProvider';

const offered: OfferedProvider[] = [
  { name: 'deepgram', encodings: ['linear16', 'opus'] },
  { name: 'assemblyai', encodings: ['linear16'] },
];

describe('resolveProvider', () => {
  it('uses the saved choice when the server offers it', () => {
    expect(resolveProvider(offered, 'assemblyai')).toBe(offered[1]);
  });

  it("falls back to the server's default when the saved choice is gone or unset", () => {
    expect(resolveProvider(offered, 'elsewhere')).toBe(offered[0]);
    expect(resolveProvider(offered, null)).toBe(offered[0]);
  });

  it('chooses nothing for servers that offer no choice', () => {
    expect(resolveProvider(undefined, 'assemblyai')).toBeUndefined();
  });
});
