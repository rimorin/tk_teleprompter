// AudioWorklet processor: runs on the audio rendering thread. Converts microphone input to
// mono 16 kHz PCM16 frames and posts them to the main thread (transferring the buffer).
import { PcmDownsampler } from './downsampler';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

type Options = { processorOptions: { targetRate: number; frameSamples: number } };

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly downsampler: PcmDownsampler;

  constructor(options: Options) {
    super(options);
    const { targetRate, frameSamples } = options.processorOptions;
    this.downsampler = new PcmDownsampler(sampleRate, targetRate, frameSamples);
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (input && input.length) {
      for (const frame of this.downsampler.push(input)) {
        this.port.postMessage(frame.buffer, [frame.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
