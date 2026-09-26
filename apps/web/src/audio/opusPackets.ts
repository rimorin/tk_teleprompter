import {
  AUDIO_FRAME_MS,
  AUDIO_SAMPLE_RATE,
  OPUS_PACKETS_BITS_PER_SECOND,
  packOpusPackets,
} from '@teleprompter/shared';

const CONFIG: AudioEncoderConfig = {
  codec: 'opus',
  sampleRate: AUDIO_SAMPLE_RATE,
  numberOfChannels: 1,
  bitrate: OPUS_PACKETS_BITS_PER_SECOND,
};
/** Opus packets are 20 ms (the WebCodecs default), so one chunk holds this many. */
const PACKETS_PER_CHUNK = AUDIO_FRAME_MS / 20;

/** Whether this browser can encode Opus packets itself (WebCodecs; Safari 26+, Chrome). */
export async function canEncodeOpusPackets(): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  try {
    return (await AudioEncoder.isConfigSupported(CONFIG)).supported === true;
  } catch {
    return false;
  }
}

/**
 * Encodes 100 ms chunks of 16 kHz PCM16 into Opus packets, and delivers each chunk's packets as
 * one frame (see packOpusPackets). The encoder is asynchronous, so a frame goes out once all of
 * a chunk's packets have come back.
 */
export function createOpusPacketizer(onFrame: (frame: ArrayBuffer) => void, onError: () => void) {
  let packets: Uint8Array[] = [];
  const deliver = () => {
    if (!packets.length) return;
    onFrame(packOpusPackets(packets).buffer as ArrayBuffer);
    packets = [];
  };
  const encoder = new AudioEncoder({
    output: (chunk) => {
      const packet = new Uint8Array(chunk.byteLength);
      chunk.copyTo(packet);
      packets.push(packet);
      if (packets.length >= PACKETS_PER_CHUNK) deliver();
    },
    error: onError,
  });
  encoder.configure(CONFIG);
  let timestamp = 0; // microseconds
  return {
    push(pcm: ArrayBuffer) {
      if (encoder.state !== 'configured') return;
      const frames = pcm.byteLength / 2;
      const data = new AudioData({
        format: 's16',
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfFrames: frames,
        numberOfChannels: 1,
        timestamp,
        data: pcm,
      });
      timestamp += (frames / AUDIO_SAMPLE_RATE) * 1_000_000;
      encoder.encode(data);
      data.close();
    },
    /** Encode what is left and deliver it, so the final words are sent. */
    async close() {
      if (encoder.state === 'configured') await encoder.flush().catch(() => {});
      deliver();
      if (encoder.state !== 'closed') encoder.close();
    },
  };
}
