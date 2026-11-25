import type { HdrCompositor } from "../color/hdr-working";
import { resolveOutputColorSpec } from "../export/color-output";

/**
 * Scope feed for HDR sequences. The program monitor shows the tone-mapped SDR view, which crushes everything above
 * about 400 nits into white, so scopes measured off it cannot read nits. The video engine therefore remembers the
 * compositor of the last completed preview frame, and a scope that asks (`getHdrScopeFrame`) gets the float image
 * PQ-encoded into 8-bit RGBA (0..255 spans 0..10 000 nits, the scale `signalToNits(_, "pq")` and the PQ graticule
 * use), downsampled to scope-analysis size. Nothing is read back until a scope asks, and SDR sequences never publish.
 */

export interface HdrScopeFrame {
  readonly width: number;
  readonly height: number;
  /** PQ-encoded RGBA8, alpha 255. */
  readonly data: Uint8ClampedArray;
  readonly timestamp: number;
}

const FEED_WIDTH = 480;

/** PQ-encode a float frame (3 floats per pixel, already PQ-encoded 0..1) to RGBA8 at most FEED_WIDTH wide. */
export function pqRgbToScopeFrame(rgb: Float32Array, width: number, height: number, timestamp: number): HdrScopeFrame {
  const step = Math.max(1, Math.floor(width / FEED_WIDTH));
  const w = Math.max(1, Math.floor(width / step));
  const h = Math.max(1, Math.floor(height / step));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((y * step) * width + x * step) * 3;
      const o = (y * w + x) * 4;
      // NaN and negatives land on 0 through the clamped array; values above 1 clip at 255 (10 000 nits).
      data[o] = Math.round(rgb[src] * 255);
      data[o + 1] = Math.round(rgb[src + 1] * 255);
      data[o + 2] = Math.round(rgb[src + 2] * 255);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data, timestamp };
}


interface Source {
  readonly comp: HdrCompositor;
  readonly width: number;
  readonly height: number;
  readonly timestamp: number;
}

let source: Source | null = null;
let cached: { readonly of: Source; readonly frame: HdrScopeFrame } | null = null;

/** The engine starts composing a frame: the compositor's image is incomplete until it publishes. */
export function beginHdrScopeFrame(): void {
  source = null;
}

/** Called by the video engine once an HDR preview frame is complete. Cheap: only keeps a reference. */
export function publishHdrScopeFrame(comp: HdrCompositor, width: number, height: number, timestamp: number): void {
  source = { comp, width, height, timestamp };
}

export function clearHdrScopeFrame(): void {
  source = null;
  cached = null;
}

/** The last completed HDR preview frame as PQ-encoded scope pixels, or null when none (SDR sequence, nothing rendered yet). */
export function getHdrScopeFrame(): HdrScopeFrame | null {
  const current = source;
  if (!current) return null;
  if (cached?.of === current) return cached.frame;
  const spec = resolveOutputColorSpec("rec2020", "pq");
  if (!spec) return null;
  const frame = pqRgbToScopeFrame(current.comp.readEncodedRgb(spec), current.width, current.height, current.timestamp);
  cached = { of: current, frame };
  return frame;
}
