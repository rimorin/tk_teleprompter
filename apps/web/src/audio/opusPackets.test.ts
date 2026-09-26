import { afterEach, describe, expect, it, vi } from 'vitest';
import { unpackOpusPackets } from '@teleprompter/shared';
import { createOpusPacketizer } from './opusPackets';

/** Fake WebCodecs encoder: one 2-byte packet per 20 ms of input, delivered asynchronously. */
class FakeEncoder {
  static last: FakeEncoder;
  state = 'unconfigured';
  config: AudioEncoderConfig | null = null;
  private next = 0;
  private queued: Promise<void> = Promise.resolve();
  constructor(private readonly init: { output: (chunk: unknown) => void }) {
    FakeEncoder.last = this;
  }
  configure(config: AudioEncoderConfig) {
    this.config = config;
    this.state = 'configured';
  }
  encode(data: { numberOfFrames: number }) {
    const packets = data.numberOfFrames / 320;
    for (let i = 0; i < packets; i++) {
      const n = this.next++;
      this.queued = this.queued.then(() =>
        this.init.output({ byteLength: 2, copyTo: (b: Uint8Array) => b.set([n >> 8, n & 0xff]) }),
      );
    }
  }
  flush() {
    return this.queued;
  }
  close() {
    this.state = 'closed';
  }
}
class FakeAudioData {
  numberOfFrames: number;
  constructor(init: { numberOfFrames: number }) {
    this.numberOfFrames = init.numberOfFrames;
  }
  close() {}
}

afterEach(() => vi.unstubAllGlobals());

describe('createOpusPacketizer', () => {
  it("sends each 100 ms chunk's five packets as one frame, and the rest on close", async () => {
    vi.stubGlobal('AudioEncoder', FakeEncoder);
    vi.stubGlobal('AudioData', FakeAudioData);
    const frames: Uint8Array[][] = [];
    const p = createOpusPacketizer(
      (frame) => frames.push(unpackOpusPackets(new Uint8Array(frame))!),
      () => {},
    );
    expect(FakeEncoder.last.config).toMatchObject({
      codec: 'opus',
      sampleRate: 16000,
      bitrate: 16000,
    });
    p.push(new ArrayBuffer(3200)); // 100 ms at 16 kHz
    p.push(new ArrayBuffer(1280)); // 40 ms: not a whole chunk yet
    await FakeEncoder.last.flush();
    expect(frames.map((f) => f.length)).toEqual([5]);
    await p.close();
    expect(frames.map((f) => f.length)).toEqual([5, 2]);
    expect(frames.flat().map((b) => b[1])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
