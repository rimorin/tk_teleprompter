/**
 * Framing for raw Opus packets on the audio WebSocket: one binary frame carries the packets of
 * one ~100 ms chunk, each prefixed with its length as a 16-bit big-endian integer. (One frame per
 * 20 ms packet would spend about as many bytes on headers as on audio.)
 */
export function packOpusPackets(packets: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(packets.reduce((n, p) => n + 2 + p.length, 0));
  let at = 0;
  for (const p of packets) {
    out[at] = p.length >> 8;
    out[at + 1] = p.length & 0xff;
    out.set(p, at + 2);
    at += 2 + p.length;
  }
  return out;
}

/** The packets in a frame, or null if it is malformed (an empty packet or a truncated one). */
export function unpackOpusPackets(frame: Uint8Array): Uint8Array[] | null {
  const packets: Uint8Array[] = [];
  for (let at = 0; at < frame.length;) {
    if (at + 2 > frame.length) return null;
    const length = (frame[at]! << 8) | frame[at + 1]!;
    if (length === 0 || at + 2 + length > frame.length) return null;
    packets.push(frame.subarray(at + 2, at + 2 + length));
    at += 2 + length;
  }
  return packets;
}
