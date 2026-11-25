import type { FillPatch } from "./types";

export interface PixelFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * Lays a frame's fill patch over a frame of any size (the analysis frame covers the same picture, scaled).
 * The patch is sampled bilinearly, so the preview (small canvas) and the export (full size) show the same fill
 * at their own resolution. Pixels outside the patch are not touched. Returns whether anything changed.
 */
export function applyFillPatch(frame: PixelFrame, patch: FillPatch, analysisWidth: number, analysisHeight: number): boolean {
  const { width: fw, height: fh, data } = frame;
  if (fw <= 0 || fh <= 0 || analysisWidth <= 0 || analysisHeight <= 0) return false;
  const sx = analysisWidth / fw;
  const sy = analysisHeight / fh;
  const xStart = Math.max(0, Math.floor(patch.x / sx));
  const xEnd = Math.min(fw, Math.ceil((patch.x + patch.width) / sx));
  const yStart = Math.max(0, Math.floor(patch.y / sy));
  const yEnd = Math.min(fh, Math.ceil((patch.y + patch.height) / sy));
  const pd = patch.data;
  let changed = false;
  for (let y = yStart; y < yEnd; y++) {
    const ly = Math.min(patch.height - 1, Math.max(0, (y + 0.5) * sy - 0.5 - patch.y));
    const y0 = Math.floor(ly);
    const y1 = Math.min(patch.height - 1, y0 + 1);
    const ay = ly - y0;
    for (let x = xStart; x < xEnd; x++) {
      const lx = Math.min(patch.width - 1, Math.max(0, (x + 0.5) * sx - 0.5 - patch.x));
      const x0 = Math.floor(lx);
      const x1 = Math.min(patch.width - 1, x0 + 1);
      const ax = lx - x0;
      const i00 = (y0 * patch.width + x0) * 4;
      const i10 = (y0 * patch.width + x1) * 4;
      const i01 = (y1 * patch.width + x0) * 4;
      const i11 = (y1 * patch.width + x1) * 4;
      const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
      const alpha = (pd[i00 + 3] * w00 + pd[i10 + 3] * w10 + pd[i01 + 3] * w01 + pd[i11 + 3] * w11) / 255;
      if (alpha <= 0.002) continue;
      const o = (y * fw + x) * 4;
      for (let c = 0; c < 3; c++) {
        const fill = pd[i00 + c] * w00 + pd[i10 + c] * w10 + pd[i01 + c] * w01 + pd[i11 + c] * w11;
        data[o + c] = data[o + c] + (fill - data[o + c]) * alpha;
      }
      changed = true;
    }
  }
  return changed;
}
