/**
 * AVC (H.264) helpers for stream-copy muxing. Packets are AVCC (length
 * prefixed); the SPS/PPS live in the avcC decoder configuration record.
 * Mixing re-encoded and copied packets in one track works when each run
 * announces its own parameter sets in-band at its first key frame.
 */

export interface AvcParameterSets {
  readonly nalLengthSize: number;
  readonly sps: readonly Uint8Array[];
  readonly pps: readonly Uint8Array[];
}

/** Parse an AVCDecoderConfigurationRecord. Returns null when malformed. */
export function parseAvcC(avcC: Uint8Array): AvcParameterSets | null {
  if (avcC.length < 7 || avcC[0] !== 1) return null;
  const nalLengthSize = (avcC[4] & 0x03) + 1;
  let pos = 5;
  const spsCount = avcC[pos++] & 0x1f;
  const sps: Uint8Array[] = [];
  for (let i = 0; i < spsCount; i++) {
    if (pos + 2 > avcC.length) return null;
    const len = (avcC[pos] << 8) | avcC[pos + 1];
    pos += 2;
    if (pos + len > avcC.length) return null;
    sps.push(avcC.slice(pos, pos + len));
    pos += len;
  }
  if (pos >= avcC.length) return null;
  const ppsCount = avcC[pos++];
  const pps: Uint8Array[] = [];
  for (let i = 0; i < ppsCount; i++) {
    if (pos + 2 > avcC.length) return null;
    const len = (avcC[pos] << 8) | avcC[pos + 1];
    pos += 2;
    if (pos + len > avcC.length) return null;
    pps.push(avcC.slice(pos, pos + len));
    pos += len;
  }
  return { nalLengthSize, sps, pps };
}

/** Stable identity of a parameter-set group, for "did the active SPS/PPS change". */
export function parameterSetKey(sets: AvcParameterSets): string {
  const hex = (n: Uint8Array) => Array.from(n, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${sets.sps.map(hex).join("+")}|${sets.pps.map(hex).join("+")}`;
}

/** Return `packet` with `sets` prepended as length-prefixed NAL units. */
export function prependParameterSets(packet: Uint8Array, sets: AvcParameterSets): Uint8Array {
  const nals = [...sets.sps, ...sets.pps];
  const size = sets.nalLengthSize;
  const extra = nals.reduce((sum, nal) => sum + size + nal.length, 0);
  const out = new Uint8Array(extra + packet.length);
  let pos = 0;
  for (const nal of nals) {
    for (let shift = size - 1; shift >= 0; shift--) out[pos++] = (nal.length >>> (8 * shift)) & 0xff;
    out.set(nal, pos);
    pos += nal.length;
  }
  out.set(packet, pos);
  return out;
}

/** Decoder-config `description` (BufferSource or SharedArrayBuffer) as bytes. */
export function descriptionBytes(description: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(description.buffer as ArrayBuffer, description.byteOffset, description.byteLength);
  }
  return new Uint8Array(description as ArrayBuffer);
}
