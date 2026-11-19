/**
 * CEA-608 captions carried inside the H.264 video stream (ATSC A/53 "GA94" cc_data
 * in a `user_data_registered_itu_t_t35` SEI), the way broadcast encoders and x264's
 * `-a53cc` do it. Players and decoders that read line-21 captions from the video
 * (QuickTime, VLC, ffmpeg's `subcc`, broadcast ingest) show them; no container
 * subtitle track is involved, so it works in plain MP4 where `c608` cannot.
 *
 * Everything here is pure: SCC text in, per-frame byte pairs out; byte pairs in, SEI
 * NAL unit out; an AVCC sample in, the same sample with the SEI inserted out. The
 * file-level pass lives in `export/caption-sei-embed.ts`.
 *
 * Scope: CEA-608 field 1 (CC1) at 29.97 / 30 fps, the rates SCC itself is defined
 * for (one byte pair per frame). Other rates are refused with a message rather than
 * written with the wrong caption timing.
 */
import { resolveCaptionFrameRate, timecodeToFrames, type CaptionFrameRate } from "./caption-timecode";

export const CEA608_SEI_FRAME_RATES = [29.97, 30] as const;

export type Cc608Pair = readonly [number, number];

export interface Cc608FrameSchedule {
  /** frame index (from time 0) -> the field-1 byte pair sent with that frame. */
  readonly pairs: ReadonlyMap<number, Cc608Pair>;
  readonly rate: CaptionFrameRate;
  /** Pairs scheduled, and the last scheduled frame. */
  readonly pairCount: number;
  readonly lastFrame: number;
  readonly warnings: string[];
}

export const isSupportedCea608Rate = (fps: number): boolean => CEA608_SEI_FRAME_RATES.some((rate) => Math.abs(rate - fps) < 0.02);

/**
 * Read an SCC file's byte pairs as a frame schedule. Each timecode line starts a run: the n-th
 * 4-hex word of the run is sent with frame (timecode + n). `offsetSeconds` is subtracted (an SCC
 * that starts at 01:00:00;00 maps to frame 0).
 */
export function sccToFrameSchedule(
  scc: string,
  options: { frameRate: number; offsetSeconds?: number },
): Cc608FrameSchedule {
  const warnings: string[] = [];
  const text = scc.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (!/^\s*Scenarist_SCC/i.test(lines[0] ?? "")) throw new Error('Not an SCC file: the "Scenarist_SCC V1.0" header is missing.');
  const hasDrop = lines.some((line) => /^\d{1,2}:\d{2}:\d{2};\d{2}\s/.test(line.trim()));
  const rate = resolveCaptionFrameRate(options.frameRate, hasDrop);
  if (!isSupportedCea608Rate(rate.fps)) {
    throw new Error(`CEA-608 in the video stream supports 29.97 and 30 fps (SCC timing); this project is ${rate.fps} fps.`);
  }
  const offsetFrames = Math.round((options.offsetSeconds ?? 0) * rate.fps);
  const pairs = new Map<number, Cc608Pair>();
  let lastFrame = 0;
  let overlaps = 0;
  for (let i = 1; i < lines.length; i++) {
    const match = /^(\d{1,2}:\d{2}:\d{2}[:;.,]\d{2})\s+(.*)$/.exec(lines[i].trim());
    if (!match) continue;
    const start = timecodeToFrames(match[1], rate);
    if (start === null) {
      warnings.push(`Line ${i + 1}: unreadable timecode "${match[1]}" skipped.`);
      continue;
    }
    const words = match[2].split(/\s+/).filter((word) => /^[0-9a-fA-F]{4}$/.test(word));
    words.forEach((word, n) => {
      const frame = start + n - offsetFrames;
      if (frame < 0) return;
      const pair: Cc608Pair = [parseInt(word.slice(0, 2), 16), parseInt(word.slice(2), 16)];
      if (pairs.has(frame)) overlaps++;
      pairs.set(frame, pair);
      if (frame > lastFrame) lastFrame = frame;
    });
  }
  if (overlaps > 0) warnings.push(`${overlaps} byte pair(s) overlapped a later run and were replaced.`);
  return { pairs, rate, pairCount: pairs.size, lastFrame, warnings };
}

/** The ATSC A/53 `cc_data()` payload (inside the T.35 wrapper) for field-1 byte pairs. */
export function buildCcDataPayload(pairs: readonly Cc608Pair[]): Uint8Array {
  if (pairs.length === 0 || pairs.length > 31) throw new Error("cc_data carries 1 to 31 byte pairs.");
  const out = new Uint8Array(11 + pairs.length * 3);
  let i = 0;
  out[i++] = 0xb5; // itu_t_t35_country_code: United States
  out[i++] = 0x00; // itu_t_t35_provider_code (ATSC)
  out[i++] = 0x31;
  out[i++] = 0x47; // 'G' 'A' '9' '4'
  out[i++] = 0x41;
  out[i++] = 0x39;
  out[i++] = 0x34;
  out[i++] = 0x03; // user_data_type_code: cc_data
  out[i++] = 0x40 | pairs.length; // process_cc_data_flag + cc_count
  out[i++] = 0xff; // em_data
  for (const [a, b] of pairs) {
    out[i++] = 0xfc; // marker bits + cc_valid + cc_type 0 (NTSC line 21, field 1)
    out[i++] = a & 0xff;
    out[i++] = b & 0xff;
  }
  out[i++] = 0xff; // marker_bits
  return out;
}

/** RBSP -> NAL payload: insert emulation prevention (0x03) so no start code appears inside. */
function escapeRbsp(rbsp: Uint8Array): number[] {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of rbsp) {
    if (zeros >= 2 && byte <= 3) {
      out.push(0x03);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return out;
}

/** One SEI NAL unit (header 0x06, no length prefix / start code) carrying the cc_data payload. */
export function buildCea608SeiNal(pairs: readonly Cc608Pair[]): Uint8Array {
  const payload = buildCcDataPayload(pairs);
  const rbsp: number[] = [0x04]; // payloadType: user_data_registered_itu_t_t35
  let size = payload.length;
  while (size >= 255) {
    rbsp.push(0xff);
    size -= 255;
  }
  rbsp.push(size, ...payload, 0x80); // rbsp_trailing_bits
  return Uint8Array.from([0x06, ...escapeRbsp(Uint8Array.from(rbsp))]);
}

/** NAL unit types of one length-prefixed (AVCC / `avc1`) sample. */
export function avccNalTypes(sample: Uint8Array, lengthSize: number): number[] {
  const types: number[] = [];
  let at = 0;
  while (at + lengthSize < sample.length) {
    let length = 0;
    for (let i = 0; i < lengthSize; i++) length = length * 256 + sample[at + i];
    at += lengthSize;
    if (length <= 0 || at + length > sample.length) break;
    types.push(sample[at] & 0x1f);
    at += length;
  }
  return types;
}

/** True when the sample already carries an A/53 cc_data SEI (do not add a second one). */
export function hasA53Sei(sample: Uint8Array, lengthSize: number): boolean {
  let at = 0;
  while (at + lengthSize < sample.length) {
    let length = 0;
    for (let i = 0; i < lengthSize; i++) length = length * 256 + sample[at + i];
    at += lengthSize;
    if (length <= 0 || at + length > sample.length) break;
    if ((sample[at] & 0x1f) === 6) {
      // bytes: nal header, payloadType 4, payloadSize, B5 00 31 'GA94'
      for (let i = at + 1; i + 7 < at + length; i++) {
        if (sample[i] === 0xb5 && sample[i + 1] === 0x00 && sample[i + 2] === 0x31 && sample[i + 3] === 0x47 && sample[i + 4] === 0x41 && sample[i + 5] === 0x39 && sample[i + 6] === 0x34) return true;
      }
    }
    at += length;
  }
  return false;
}

/**
 * The sample with the SEI NAL inserted directly before the first VCL NAL unit (after any access unit
 * delimiter, SPS, PPS or earlier SEI), as the standard requires for an SEI of the primary picture.
 * Returns the sample unchanged when it has no picture NAL or already carries cc_data.
 */
export function insertSeiIntoAvccSample(sample: Uint8Array, lengthSize: number, sei: Uint8Array): Uint8Array {
  if (hasA53Sei(sample, lengthSize)) return sample;
  let at = 0;
  let insertAt = -1;
  while (at + lengthSize < sample.length) {
    let length = 0;
    for (let i = 0; i < lengthSize; i++) length = length * 256 + sample[at + i];
    const nalStart = at + lengthSize;
    if (length <= 0 || nalStart + length > sample.length) break;
    const type = sample[nalStart] & 0x1f;
    if (type >= 1 && type <= 5) {
      insertAt = at;
      break;
    }
    at = nalStart + length;
  }
  if (insertAt < 0) return sample;
  const out = new Uint8Array(sample.length + lengthSize + sei.length);
  out.set(sample.subarray(0, insertAt), 0);
  let n = sei.length;
  for (let i = lengthSize - 1; i >= 0; i--) {
    out[insertAt + i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  out.set(sei, insertAt + lengthSize);
  out.set(sample.subarray(insertAt), insertAt + lengthSize + sei.length);
  return out;
}

/** The `lengthSizeMinusOne + 1` of an avcC decoder configuration record (the NAL length prefix size). */
export function avcLengthSize(description: ArrayBufferLike | ArrayBufferView | undefined | null): number {
  if (!description) return 4;
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
  return bytes.length > 4 && bytes[0] === 1 ? (bytes[4] & 0x03) + 1 : 4;
}
