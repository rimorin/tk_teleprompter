import { describe, expect, it } from 'vitest';
import { PcmDownsampler } from './downsampler';

describe('PcmDownsampler', () => {
  it('produces 100 ms frames at 16 kHz from 48 kHz input in 128-sample blocks', () => {
    const d = new PcmDownsampler(48_000, 16_000, 1600);
    const frames: Int16Array[] = [];
    for (let i = 0; i < 375; i++) frames.push(...d.push([new Float32Array(128).fill(0.5)])); // 1 s
    expect(frames).toHaveLength(10);
    expect(frames.every((f) => f.length === 1600)).toBe(true);
    expect(frames[3]![100]).toBe(Math.round(0.5 * 0x7fff));
  });

  it('handles non-integer ratios (44.1 kHz) without drift', () => {
    const d = new PcmDownsampler(44_100, 16_000, 1600);
    let samples = 0;
    for (let i = 0; i < 44_100 / 147; i++) {
      for (const f of d.push([new Float32Array(147).fill(-0.25)])) samples += f.length;
    }
    expect(samples).toBe(16_000);
  });

  it('downmixes channels and clamps', () => {
    const d = new PcmDownsampler(16_000, 16_000, 4);
    const [frame] = d.push([
      Float32Array.from([1, -1, 2, 0.5]),
      Float32Array.from([0, -1, 2, -0.5]),
    ]);
    expect(Array.from(frame!)).toEqual([Math.round(0.5 * 0x7fff), -0x8000, 0x7fff, 0]);
  });

  it('attenuates a tone above the output Nyquist frequency', () => {
    const d = new PcmDownsampler(48_000, 16_000, 1600);
    const tone = Float32Array.from({ length: 4800 }, (_, i) =>
      Math.sin((2 * Math.PI * 12_000 * i) / 48_000),
    );
    const [frame] = d.push([tone]);
    const peak = Math.max(...Array.from(frame!).map(Math.abs)) / 0x7fff;
    expect(peak).toBeLessThan(0.5);
  });

  it('rejects input rates below the output rate', () => {
    expect(() => new PcmDownsampler(8_000, 16_000, 1600)).toThrow();
  });
});
