import { promises as fs } from "node:fs";
import { HDR10_MAX_CLL } from "./color-output-args";

/**
 * Writes the measured MaxCLL / MaxFALL into a finished HDR10 file.
 *
 * libx265 writes the content light level SEI with the first headers, before a single frame has been rendered, and
 * `max-cll=0,0` writes zeros (not a computed value). The renderer measures the real values as it encodes
 * (core `color/hdr-light-level.ts`), so after ffmpeg exits the declared SEI is replaced in place: the payload is four
 * bytes (two big-endian uint16), so the file keeps its size and every offset. Two places carry it:
 *
 *   - HEVC prefix SEI, payload type 144 (CONTENT_LIGHT_LEVEL_INFO), size 4: in the `hvcC` parameter-set array and in
 *     every repeated header (`repeat-headers=1`);
 *   - an `clli` box, when the muxer wrote one.
 *
 * Only the exact bytes the encoder was asked to declare are replaced, so unrelated data cannot be touched, and a
 * value pair whose bytes would form an emulation-prevention hazard (00 00 0x) is left declared.
 */

export interface MeasuredLightLevel {
  readonly maxCll: number;
  readonly maxFall: number;
}

function payload(maxCll: number, maxFall: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt16BE(maxCll, 0);
  b.writeUInt16BE(maxFall, 2);
  return b;
}

const [DECLARED_CLL, DECLARED_FALL] = HDR10_MAX_CLL.split(",").map((v) => Number(v));
const DECLARED = payload(DECLARED_CLL, DECLARED_FALL);
const SEI_PREFIX = Buffer.from([0x90, 0x04]);
const CLLI_TAG = Buffer.from("clli", "latin1");

/** True when the four payload bytes cannot be written into a NAL unit as they are (00 00 followed by 00-03). */
export function hasEmulationHazard(bytes: Buffer): boolean {
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] <= 3) return true;
  }
  // The SEI's rbsp trailing byte (0x80) follows the payload, so the last two bytes are safe on their own.
  return false;
}

export function clampLightLevel(level: MeasuredLightLevel): MeasuredLightLevel {
  const clamp = (v: number): number => Math.max(0, Math.min(65535, Math.round(Number.isFinite(v) ? v : 0)));
  return { maxCll: clamp(level.maxCll), maxFall: clamp(level.maxFall) };
}

/** Replace every declared light-level payload in `data` (mutates). Returns the number of replacements. */
export function patchLightLevelBuffer(data: Buffer, level: MeasuredLightLevel): number {
  const next = payload(level.maxCll, level.maxFall);
  if (hasEmulationHazard(next)) return 0;
  let count = 0;
  for (const [tag, skip] of [[SEI_PREFIX, SEI_PREFIX.length], [CLLI_TAG, CLLI_TAG.length]] as const) {
    let at = data.indexOf(tag);
    while (at !== -1) {
      const start = at + skip;
      if (start + 4 <= data.length && data.compare(DECLARED, 0, 4, start, start + 4) === 0) {
        next.copy(data, start);
        count++;
      }
      at = data.indexOf(tag, at + 1);
    }
  }
  return count;
}

const CHUNK = 4 * 1024 * 1024;
const OVERLAP = 16;

/** Patch a file in place, reading it in chunks. Returns how many places were rewritten (0 = nothing found / left declared). */
export async function patchContentLightLevel(path: string, measured: MeasuredLightLevel): Promise<number> {
  const level = clampLightLevel(measured);
  const handle = await fs.open(path, "r+");
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(CHUNK + OVERLAP);
    let patched = 0;
    for (let offset = 0; offset < size; offset += CHUNK) {
      const length = Math.min(CHUNK + OVERLAP, size - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const view = buffer.subarray(0, bytesRead);
      const count = patchLightLevelBuffer(view, level);
      if (count > 0) {
        await handle.write(view, 0, bytesRead, offset);
        patched += count;
      }
    }
    return patched;
  } finally {
    await handle.close();
  }
}
