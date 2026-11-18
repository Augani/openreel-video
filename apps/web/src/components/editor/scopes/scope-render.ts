import {
  computeHlsVectorscope,
  computeYcWaveform,
} from "@openreel/core/video/scopes-extra";
import {
  computeLumaWaveform,
  computeRgbHistogram,
  computeRgbParade,
  computeVectorscope,
  downsampleForScopes,
  type ScopeImageLike,
  type ScopeWaveform,
} from "@openreel/core/video/scopes";

export type ScopeKind =
  | "waveform"
  | "parade"
  | "yc"
  | "vectorscope"
  | "hls"
  | "histogram";

export interface ScopeRaster {
  kind: ScopeKind;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

/** Frame width the scopes analyse (columns of the waveforms). */
export const SCOPE_ANALYSIS_WIDTH = 512;

/** Raster size of each scope for an analysis frame of SCOPE_ANALYSIS_WIDTH. */
export function scopeDimensions(kind: ScopeKind): { width: number; height: number } {
  switch (kind) {
    case "waveform":
    case "yc":
      return { width: SCOPE_ANALYSIS_WIDTH, height: 256 };
    case "parade":
      return { width: SCOPE_ANALYSIS_WIDTH * 3, height: 256 };
    case "vectorscope":
    case "hls":
      return { width: VECTOR_SIZE, height: VECTOR_SIZE };
    case "histogram":
      return { width: 256, height: 128 };
  }
}

/** Cheap probe (every 13th pixel) for whether a read-back has any non-transparent pixel. */
export function frameHasContent(data: Uint8ClampedArray | Uint8Array): boolean {
  for (let i = 3; i < data.length; i += 4 * 13) {
    if (data[i] !== 0) return true;
  }
  return false;
}
const VECTOR_SIZE = 320;
const HIST_HEIGHT = 128;

type Tint = readonly [number, number, number];

function intensity(count: number, max: number, gain: number): number {
  if (count === 0 || max === 0) return 0;
  // sqrt curve keeps sparse traces visible next to dense ones
  return Math.min(1, Math.sqrt(count / max) * gain);
}

/** Additively paint a waveform into a raster at a horizontal offset. */
function paintWaveform(
  out: Uint8ClampedArray,
  outWidth: number,
  xOffset: number,
  wf: ScopeWaveform,
  tint: Tint,
): void {
  const { bins, width, height, max } = wf;
  for (let level = 0; level < height; level++) {
    const row = height - 1 - level; // white at the top
    for (let x = 0; x < width; x++) {
      const n = bins[level * width + x];
      if (n === 0) continue;
      const v = intensity(n, max, 1.4);
      const o = (row * outWidth + xOffset + x) * 4;
      out[o] = Math.min(255, out[o] + tint[0] * v);
      out[o + 1] = Math.min(255, out[o + 1] + tint[1] * v);
      out[o + 2] = Math.min(255, out[o + 2] + tint[2] * v);
    }
  }
}

function blank(width: number, height: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  return px;
}

export function renderScope(
  kind: ScopeKind,
  source: ScopeImageLike,
): ScopeRaster {
  const img = downsampleForScopes(source, SCOPE_ANALYSIS_WIDTH);

  if (kind === "waveform") {
    const wf = computeLumaWaveform(img);
    const pixels = blank(wf.width, wf.height);
    paintWaveform(pixels, wf.width, 0, wf, [140, 255, 140]);
    return { kind, width: wf.width, height: wf.height, pixels };
  }

  if (kind === "yc") {
    const yc = computeYcWaveform(img);
    const pixels = blank(yc.luma.width, yc.luma.height);
    paintWaveform(pixels, yc.luma.width, 0, yc.luma, [140, 255, 140]);
    paintWaveform(pixels, yc.chroma.width, 0, yc.chroma, [60, 200, 255]);
    return { kind, width: yc.luma.width, height: yc.luma.height, pixels };
  }

  if (kind === "hls") {
    const v = computeHlsVectorscope(img, VECTOR_SIZE);
    const pixels = blank(v.size, v.size);
    for (let i = 0; i < v.bins.length; i++) {
      const n = v.bins[i];
      if (n === 0) continue;
      // brightness of the trace follows mean lightness, density sets the floor
      const light = v.lightnessSum[i] / n;
      const k = 0.35 + 0.65 * intensity(n, v.max, 1.8);
      const o = i * 4;
      const v8 = Math.min(255, 255 * k * (0.4 + 0.6 * light));
      pixels[o] = v8;
      pixels[o + 1] = v8;
      pixels[o + 2] = v8;
    }
    return { kind, width: v.size, height: v.size, pixels };
  }

  if (kind === "parade") {
    const p = computeRgbParade(img);
    const w = p.red.width;
    const pixels = blank(w * 3, p.red.height);
    paintWaveform(pixels, w * 3, 0, p.red, [255, 70, 70]);
    paintWaveform(pixels, w * 3, w, p.green, [70, 255, 70]);
    paintWaveform(pixels, w * 3, w * 2, p.blue, [90, 120, 255]);
    return { kind, width: w * 3, height: p.red.height, pixels };
  }

  if (kind === "vectorscope") {
    const v = computeVectorscope(img, VECTOR_SIZE);
    const pixels = blank(v.size, v.size);
    for (let i = 0; i < v.bins.length; i++) {
      const n = v.bins[i];
      if (n === 0) continue;
      const k = intensity(n, v.max, 1.8);
      const o = i * 4;
      pixels[o] = 120 + 135 * k;
      pixels[o + 1] = 255 * k;
      pixels[o + 2] = 120 + 135 * k;
    }
    return { kind, width: v.size, height: v.size, pixels };
  }

  const h = computeRgbHistogram(img);
  const pixels = blank(256, HIST_HEIGHT);
  const channels: Array<[Uint32Array, Tint]> = [
    [h.red, [255, 60, 60]],
    [h.green, [60, 255, 60]],
    [h.blue, [70, 110, 255]],
  ];
  for (const [bins, tint] of channels) {
    for (let x = 0; x < 256; x++) {
      const barH = Math.min(
        HIST_HEIGHT,
        Math.round((bins[x] / Math.max(1, h.max)) * (HIST_HEIGHT - 2)),
      );
      for (let y = HIST_HEIGHT - barH; y < HIST_HEIGHT; y++) {
        const o = (y * 256 + x) * 4;
        pixels[o] = Math.min(255, pixels[o] + tint[0] * 0.7);
        pixels[o + 1] = Math.min(255, pixels[o + 1] + tint[1] * 0.7);
        pixels[o + 2] = Math.min(255, pixels[o + 2] + tint[2] * 0.7);
      }
    }
  }
  // Luma overlay: white outline so it stays readable over the RGB fills.
  let prevTop = HIST_HEIGHT - 1;
  for (let x = 0; x < 256; x++) {
    const barH = Math.min(
      HIST_HEIGHT - 1,
      Math.round((h.luma[x] / Math.max(1, h.max)) * (HIST_HEIGHT - 2)),
    );
    const top = HIST_HEIGHT - 1 - barH;
    const from = Math.min(top, prevTop);
    const to = Math.max(top, prevTop);
    for (let y = from; y <= to; y++) {
      const o = (y * 256 + x) * 4;
      pixels[o] = pixels[o + 1] = pixels[o + 2] = 235;
    }
    prevTop = top;
  }
  return { kind, width: 256, height: HIST_HEIGHT, pixels };
}
