import { pqDecodeToNits } from "../export/color-output";

/**
 * MaxCLL / MaxFALL measured from the frames an HDR export actually renders (CTA-861.3 content light level).
 *
 *   MaxCLL   the largest R, G or B component of any pixel of any frame, in nits
 *   MaxFALL  the largest frame average of each pixel's max(R, G, B), in nits
 *
 * The meter reads the PQ-encoded R'G'B' the export sends to the encoder (so it measures what was written, after
 * the output clip to 10 000 nits), decoding through a table: one lookup per pixel instead of a pow.
 */

export interface HdrLightLevel {
  /** Whole nits, 0..65535 (the SEI fields are 16 bit). */
  readonly maxCll: number;
  readonly maxFall: number;
  readonly frames: number;
}

const TABLE_SIZE = 8192;
let pqNitsTable: Float32Array | null = null;

function nitsTable(): Float32Array {
  if (!pqNitsTable) {
    pqNitsTable = new Float32Array(TABLE_SIZE + 1);
    for (let i = 0; i <= TABLE_SIZE; i++) pqNitsTable[i] = pqDecodeToNits(i / TABLE_SIZE);
  }
  return pqNitsTable;
}

export class HdrLightLevelMeter {
  private maxSignal = 0;
  private maxFall = 0;
  private frames = 0;

  /** One frame of PQ-encoded R'G'B' (three floats per pixel, 0..1). */
  add(encodedRgb: Float32Array): void {
    const table = nitsTable();
    const pixels = Math.floor(encodedRgb.length / 3);
    if (pixels === 0) return;
    let frameMax = 0;
    let sum = 0;
    for (let p = 0, q = 0; p < pixels; p++, q += 3) {
      const r = encodedRgb[q];
      const g = encodedRgb[q + 1];
      const b = encodedRgb[q + 2];
      const m = r > g ? (r > b ? r : b) : g > b ? g : b;
      if (m > frameMax) frameMax = m;
      const pos = (m <= 0 ? 0 : m >= 1 ? 1 : m) * TABLE_SIZE;
      const lo = Math.floor(pos);
      const hi = lo >= TABLE_SIZE ? TABLE_SIZE : lo + 1;
      sum += table[lo] + (table[hi] - table[lo]) * (pos - lo);
    }
    if (frameMax > this.maxSignal) this.maxSignal = frameMax;
    const fall = sum / pixels;
    if (fall > this.maxFall) this.maxFall = fall;
    this.frames++;
  }

  /** Null until a frame has been measured. */
  result(): HdrLightLevel | null {
    if (this.frames === 0) return null;
    const clamp = (nits: number): number => Math.max(0, Math.min(65535, Math.round(nits)));
    return { maxCll: clamp(pqDecodeToNits(this.maxSignal)), maxFall: clamp(this.maxFall), frames: this.frames };
  }

  reset(): void {
    this.maxSignal = 0;
    this.maxFall = 0;
    this.frames = 0;
  }
}

/** "1000,400" as x265's `max-cll` and ffmpeg expect it. */
export function formatMaxCll(level: Pick<HdrLightLevel, "maxCll" | "maxFall">): string {
  return `${level.maxCll},${level.maxFall}`;
}
