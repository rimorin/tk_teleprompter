/**
 * Converts captured Float32 audio (any channel count, any rate >= target) into mono 16-bit PCM
 * frames at the target rate. Downsampling averages the input samples falling in each output
 * sample's window (a box filter), which also suppresses aliasing well enough for speech.
 */
export class PcmDownsampler {
  private readonly ratio: number;
  private acc = 0;
  private fill = 0;
  private frame: Int16Array;
  private frameIndex = 0;

  constructor(
    readonly inputRate: number,
    readonly outputRate: number,
    readonly frameSamples: number,
  ) {
    if (inputRate < outputRate) throw new Error(`input rate ${inputRate} is below ${outputRate}`);
    this.ratio = inputRate / outputRate;
    this.frame = new Int16Array(frameSamples);
  }

  /** Push one block of per-channel samples; returns any completed frames. */
  push(channels: ArrayLike<number>[]): Int16Array[] {
    const out: Int16Array[] = [];
    const n = channels[0]?.length ?? 0;
    const count = channels.length;
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (let c = 0; c < count; c++) x += channels[c]![i]!;
      x /= count;
      let remaining = 1;
      while (remaining > 0) {
        const take = Math.min(remaining, this.ratio - this.fill);
        this.acc += x * take;
        this.fill += take;
        remaining -= take;
        if (this.fill >= this.ratio - 1e-9) {
          this.emit(this.acc / this.ratio, out);
          this.acc = 0;
          this.fill = 0;
        }
      }
    }
    return out;
  }

  private emit(sample: number, out: Int16Array[]) {
    const s = Math.max(-1, Math.min(1, sample));
    this.frame[this.frameIndex++] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    if (this.frameIndex === this.frameSamples) {
      out.push(this.frame);
      this.frame = new Int16Array(this.frameSamples);
      this.frameIndex = 0;
    }
  }
}
