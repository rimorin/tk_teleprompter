import { describe, expect, it } from 'vitest';
import { packOpusPackets, unpackOpusPackets } from './opusFrames';

describe('Opus packet framing', () => {
  it('round-trips packets of any size', () => {
    const packets = [new Uint8Array([1, 2, 3]), new Uint8Array(300).fill(7), new Uint8Array([9])];
    expect(unpackOpusPackets(packOpusPackets(packets))).toEqual(packets);
  });

  it('rejects truncated frames and empty packets', () => {
    const frame = packOpusPackets([new Uint8Array([1, 2, 3])]);
    expect(unpackOpusPackets(frame.subarray(0, 4))).toBeNull();
    expect(unpackOpusPackets(frame.subarray(0, 1))).toBeNull();
    expect(unpackOpusPackets(new Uint8Array([0, 0]))).toBeNull();
  });
});
