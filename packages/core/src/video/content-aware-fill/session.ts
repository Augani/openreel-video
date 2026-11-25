import type { RGBAFrame } from "../time-interpolation/frame-blend";
import { boxBlur, growMask, maskBounds } from "../object-mask/raster-ops";
import { patchMatchInpaint, type InpaintOptions } from "./patch-match";
import { alignmentBetween, chainMaps, DEFAULT_OFFSETS, refineAlignment, temporalFill, type PointMap, type TemporalFrame } from "./temporal-fill";
import type { FillPatch } from "./types";

export interface FillSessionOptions {
  /** Pixels (of the analysis frame) the removed area grows beyond the mask. */
  readonly dilate: number;
  /** Pixels of soft edge. */
  readonly feather: number;
  /** Neighbour offsets for temporal propagation, nearest first. */
  readonly offsets?: readonly number[];
  readonly inpaint?: InpaintOptions;
}

export interface FillReport {
  readonly patch: FillPatch | null;
  /** Share of the removed area that other frames supplied (the rest was synthesised from its surroundings). */
  readonly temporalShare: number;
}

/**
 * Holds a sliding window of analysis frames (with their masks) and fills one frame at a time:
 * (1) background seen in neighbouring frames, aligned with global motion; (2) PatchMatch inpainting for what no
 * frame reveals; (3) a soft alpha edge so the fill melts into the picture.
 * Runs in the analysis worker; pure and deterministic.
 */
export class FillSession {
  private readonly frames = new Map<number, TemporalFrame & { mask: Uint8Array }>();
  /** Motion from frame i to frame i + dir, estimated once and shared by every target that needs it. */
  private readonly steps = new Map<string, PointMap>();
  private readonly offsets: readonly number[];
  private readonly reach: number;

  constructor(private readonly options: FillSessionOptions) {
    this.offsets = options.offsets ?? DEFAULT_OFFSETS;
    this.reach = Math.max(1, ...this.offsets.map(Math.abs));
  }

  get window(): number {
    return this.reach;
  }

  push(index: number, frame: RGBAFrame, mask: Uint8Array): void {
    const { width, height } = frame;
    if (mask.length !== width * height) throw new Error("The mask and the frame differ in size");
    const grown = growMask(mask, width, height, this.options.dilate + this.options.feather);
    this.frames.set(index, { frame, hole: grown, mask });
  }

  /** Frames before `index` are no longer needed. */
  release(index: number): void {
    for (const key of this.frames.keys()) if (key < index) this.frames.delete(key);
    for (const key of this.steps.keys()) if (Number(key.split(":")[0]) < index - 1) this.steps.delete(key);
  }

  private step(index: number, dir: 1 | -1): PointMap | null {
    const id = `${index}:${dir}`;
    const cached = this.steps.get(id);
    if (cached) return cached;
    const from = this.frames.get(index);
    const to = this.frames.get(index + dir);
    if (!from || !to) return null;
    const map = alignmentBetween(from, to);
    this.steps.set(id, map);
    return map;
  }

  /**
   * The neighbour `offset` frames away and where the target's pixels are in it. Large offsets chain the small, reliable
   * frame-to-frame motions: a direct estimate over tens of pixels is ambiguous on repeating texture.
   */
  private neighbour(index: number, offset: number): { frame: TemporalFrame; align: PointMap } | null {
    const frame = this.frames.get(index + offset);
    if (!frame) return null;
    const dir: 1 | -1 = offset > 0 ? 1 : -1;
    const maps: PointMap[] = [];
    for (let k = 0; k < Math.abs(offset); k++) {
      const map = this.step(index + dir * k, dir);
      if (!map) return null;
      maps.push(map);
    }
    const target = this.frames.get(index);
    if (!target) return null;
    const chain = chainMaps(maps);
    return { frame, align: Math.abs(offset) > 1 ? refineAlignment(target, frame, chain) : chain };
  }

  fill(index: number): FillReport {
    const target = this.frames.get(index);
    if (!target) throw new Error(`Frame ${index} was not pushed`);
    const { width, height } = target.frame;
    const area = target.hole;
    let areaCount = 0;
    for (let i = 0; i < area.length; i++) areaCount += area[i];
    if (areaCount === 0) return { patch: null, temporalShare: 1 };

    const temporal = temporalFill(target, area, (offset) => this.neighbour(index, offset), { offsets: this.offsets });
    const data = temporal.data;
    const unresolved = new Uint8Array(width * height);
    let unresolvedCount = 0;
    for (let i = 0; i < area.length; i++) {
      if (area[i] && !temporal.resolved[i]) {
        unresolved[i] = 1;
        unresolvedCount++;
      }
    }
    if (unresolvedCount > 0) this.inpaint(data, unresolved, width, height);

    // Alpha: fully the fill inside the grown mask, a soft ramp over the feather ring that was synthesised too.
    const core = growMask(target.mask, width, height, this.options.dilate);
    const alpha = boxBlur(Float32Array.from(core), width, height, this.options.feather);
    const bounds = maskBounds(area, width, height);
    if (!bounds) return { patch: null, temporalShare: 1 };
    const x0 = bounds.x0, y0 = bounds.y0;
    const pw = bounds.x1 - bounds.x0 + 1;
    const ph = bounds.y1 - bounds.y0 + 1;
    const out = new Uint8ClampedArray(pw * ph * 4);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const src = (y0 + y) * width + x0 + x;
        const o = (y * pw + x) * 4;
        const inArea = area[src] === 1;
        out[o] = inArea ? data[src * 4] : target.frame.data[src * 4];
        out[o + 1] = inArea ? data[src * 4 + 1] : target.frame.data[src * 4 + 1];
        out[o + 2] = inArea ? data[src * 4 + 2] : target.frame.data[src * 4 + 2];
        out[o + 3] = inArea ? Math.round(Math.min(1, Math.max(0, alpha[src])) * 255) : 0;
      }
    }
    return { patch: { x: x0, y: y0, width: pw, height: ph, data: out }, temporalShare: 1 - unresolvedCount / areaCount };
  }

  /** PatchMatch on a crop around the unresolved pixels, with enough surroundings to borrow texture from. */
  private inpaint(data: Uint8ClampedArray, unresolved: Uint8Array, width: number, height: number): void {
    const bounds = maskBounds(unresolved, width, height);
    if (!bounds) return;
    const margin = Math.max(16, Math.round(Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) * 0.75));
    const cx0 = Math.max(0, bounds.x0 - margin), cy0 = Math.max(0, bounds.y0 - margin);
    const cx1 = Math.min(width - 1, bounds.x1 + margin), cy1 = Math.min(height - 1, bounds.y1 + margin);
    const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
    const crop = new Uint8ClampedArray(cw * ch * 4);
    const hole = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const s = (cy0 + y) * width + cx0 + x;
        crop.set(data.subarray(s * 4, s * 4 + 4), (y * cw + x) * 4);
        hole[y * cw + x] = unresolved[s];
      }
    }
    // Pixels still marked as removal area (other than the ones being synthesised here) are not a source: they are fills.
    const filled = patchMatchInpaint({ width: cw, height: ch, data: crop }, hole, this.options.inpaint);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (!hole[y * cw + x]) continue;
        const s = (cy0 + y) * width + cx0 + x;
        data.set(filled.subarray((y * cw + x) * 4, (y * cw + x) * 4 + 4), s * 4);
      }
    }
  }
}
