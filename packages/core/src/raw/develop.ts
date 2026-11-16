import { linearToSrgb } from "../export/color-output";
import { cameraToOutput, outputSpaceMatrices } from "./color";
import type { DngRaw } from "./dng";
import type { RawSourceSettings } from "./settings";

/**
 * The raw developer: sensor samples -> scene-linear RGB in the chosen output
 * primaries -> display-referred 8-bit sRGB-encoded pixels.
 *
 *   1. black subtract, normalise to the white level, apply white balance
 *      (temperature / tint through the DNG colour model)
 *   2. demosaic (draft = 2x2 binning, standard = bilinear, high = Malvar-He-Cutler)
 *   3. highlight recovery, part 1: clipped pixels are neutralised (the colour of
 *      a clipped highlight is wrong, so it is pulled to the brightest channel)
 *   4. camera RGB -> XYZ (D50) -> linear output primaries (3x3)
 *   5. exposure: gain 2^(exposure + DNG baseline exposure) in linear light
 *      (`developRawLinear` stops here: unbounded scene-linear, 1.0 = diffuse white)
 *   6. highlight recovery, part 2: a hue-preserving exponential shoulder whose
 *      knee drops from 1.0 (hard clip) to 0.6 as recovery goes 0 -> 1
 *   7. sRGB OETF (all three output spaces use the sRGB curve, like Display P3)
 *
 * Rows stream through a 5-row window, so a 60 MP file never needs a full float
 * image. The function is pure and deterministic: the preview and the export
 * call it with the same arguments and get the same bytes.
 */

export interface DevelopOptions {
  /** Longest output edge; larger images are box-downscaled by an integer factor. */
  readonly maxLongEdge?: number;
}

export const DEFAULT_MAX_LONG_EDGE = 6144;
const SHOULDER_KNEE_AT_FULL_RECOVERY = 0.6;

export interface DevelopedFrame {
  readonly width: number;
  readonly height: number;
  /** Premultiplied-irrelevant opaque RGBA, sRGB transfer, in the output colour space's primaries. */
  readonly rgba: Uint8ClampedArray;
}

export interface LinearFrame {
  readonly width: number;
  readonly height: number;
  /** `width * height * 3` scene-linear values in the output primaries, exposure applied, unclamped. */
  readonly rgb: Float32Array;
}

/** Size of the developed image (crop, quality, downscale and orientation applied). */
export function developedSize(raw: DngRaw, settings: RawSourceSettings, options: DevelopOptions = {}): { width: number; height: number } {
  const plan = planGeometry(raw, settings, options);
  return plan.swap ? { width: plan.outH, height: plan.outW } : { width: plan.outW, height: plan.outH };
}

interface Geometry {
  readonly x0: number;
  readonly y0: number;
  readonly rw: number;
  readonly rh: number;
  readonly binned: boolean;
  readonly k: number;
  readonly outW: number;
  readonly outH: number;
  readonly swap: boolean;
}

function planGeometry(raw: DngRaw, settings: RawSourceSettings, options: DevelopOptions): Geometry {
  const [top, left] = raw.activeArea;
  const x0 = left + raw.crop[0];
  const y0 = top + raw.crop[1];
  const rw = raw.crop[2];
  const rh = raw.crop[3];
  const binned = settings.demosaic === "draft" && raw.samplesPerPixel === 1;
  const baseW = binned ? Math.floor(rw / 2) : rw;
  const baseH = binned ? Math.floor(rh / 2) : rh;
  const max = options.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE;
  const k = Math.max(1, Math.ceil(Math.max(baseW, baseH) / max));
  const outW = Math.floor(baseW / k);
  const outH = Math.floor(baseH / k);
  return { x0, y0, rw, rh, binned, k, outW, outH, swap: raw.orientation >= 5 };
}

/** Maps a pixel of the upright-less image to its place after applying a TIFF orientation. */
export function orientPixel(orientation: number, x: number, y: number, w: number, h: number): [number, number] {
  switch (orientation) {
    case 2: return [w - 1 - x, y];
    case 3: return [w - 1 - x, h - 1 - y];
    case 4: return [x, h - 1 - y];
    case 5: return [y, x];
    case 6: return [h - 1 - y, x];
    case 7: return [h - 1 - y, w - 1 - x];
    case 8: return [y, w - 1 - x];
    default: return [x, y];
  }
}

type RowSink = (y: number, linear: Float32Array, width: number) => void;

function reflect(i: number, n: number): number {
  // Reflection that keeps the Bayer parity (-1 -> 1, n -> n-2).
  if (n < 3) return Math.min(Math.max(i, 0), n - 1);
  if (i < 0) return i + 2;
  if (i >= n) return i - 2;
  return i;
}

function developRows(raw: DngRaw, settings: RawSourceSettings, options: DevelopOptions, sink: RowSink): Geometry {
  const geo = planGeometry(raw, settings, options);
  if (geo.outW < 1 || geo.outH < 1) throw new Error("The raw image is too small to develop.");
  const { x0, y0, rw, rh, binned, k, outW, outH } = geo;
  const { whiteBalance: wb, matrix } = cameraToOutput(raw, settings.temperature, settings.tint, settings.outputColorSpace);
  const gain = 2 ** (settings.exposure + raw.baselineExposure);
  const recovery = settings.highlightRecovery;
  const stride = raw.width * raw.samplesPerPixel;
  const data = raw.data;
  const linearRaw = raw.samplesPerPixel === 3;
  const white = raw.whiteLevel;
  const [aaTop, aaLeft] = raw.activeArea;

  // Per-cell lookup: raw code -> normalised, white-balanced value.
  const lutSize = 65536;
  const luts: Float32Array[] = [];
  const cellColor: number[] = linearRaw ? [0, 1, 2, 1] : [...raw.cfa];
  for (let n = 0; n < 4; n++) {
    const lut = new Float32Array(lutSize);
    const black = raw.blackLevel[n];
    const span = Math.max(1, white - black);
    const mult = wb[cellColor[n]];
    for (let v = 0; v < lutSize; v++) lut[v] = Math.min(1, Math.max(0, (v - black) / span)) * mult;
    luts.push(lut);
  }

  const m = matrix;

  /** Highlight part 1 + colour matrix + exposure for one white-balanced camera pixel; writes into `out` at `o`. */
  const finish = (r: number, g: number, b: number, out: Float32Array, o: number): void => {
    if (recovery > 0) {
      // Closeness of each channel to the sensor clip point (its WB multiplier).
      const cr = r / wb[0];
      const cg = g / wb[1];
      const cb = b / wb[2];
      const c = Math.max(cr, cg, cb);
      if (c > 0.85) {
        const t = Math.min(1, (c - 0.85) / 0.15);
        const s = t * t * (3 - 2 * t) * recovery;
        const top = Math.max(r, g, b);
        r += (top - r) * s;
        g += (top - g) * s;
        b += (top - b) * s;
      }
    }
    out[o] = (m[0] * r + m[1] * g + m[2] * b) * gain;
    out[o + 1] = (m[3] * r + m[4] * g + m[5] * b) * gain;
    out[o + 2] = (m[6] * r + m[7] * g + m[8] * b) * gain;
  };

  const accum = new Float32Array(outW * 3);
  const rowOut = new Float32Array(outW * 3);
  const norm = 1 / (k * k);

  if (linearRaw) {
    const lineBuf = new Float32Array(rw * 3);
    for (let oy = 0; oy < outH; oy++) {
      accum.fill(0);
      for (let j = 0; j < k; j++) {
        const sy = y0 + oy * k + j;
        const base = sy * stride;
        for (let x = 0; x < rw; x++) {
          const i = base + (x0 + x) * 3;
          finish(luts[0][data[i]], luts[1][data[i + 1]], luts[2][data[i + 2]], lineBuf, x * 3);
        }
        for (let ox = 0; ox < outW; ox++) {
          for (let dx = 0; dx < k; dx++) {
            const s = (ox * k + dx) * 3;
            accum[ox * 3] += lineBuf[s];
            accum[ox * 3 + 1] += lineBuf[s + 1];
            accum[ox * 3 + 2] += lineBuf[s + 2];
          }
        }
      }
      for (let i = 0; i < accum.length; i++) rowOut[i] = accum[i] * norm;
      sink(oy, rowOut, outW);
    }
    return geo;
  }

  const cell = (rx: number, ry: number): number => (((y0 + ry - aaTop) & 1) << 1) | ((x0 + rx - aaLeft) & 1);
  const pixelAt = (rx: number, ry: number): number => luts[cell(rx, ry)][data[(y0 + ry) * stride + x0 + rx]];
  const lineBuf = new Float32Array(Math.max(rw, 1) * 3);

  if (binned) {
    for (let oy = 0; oy < outH; oy++) {
      accum.fill(0);
      for (let j = 0; j < k; j++) {
        const by = (oy * k + j) * 2;
        for (let x = 0; x < outW * k; x++) {
          const bx = x * 2;
          const sum = [0, 0, 0];
          const cnt = [0, 0, 0];
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const col = cellColor[cell(bx + dx, by + dy)];
              sum[col] += pixelAt(bx + dx, by + dy);
              cnt[col]++;
            }
          finish(sum[0] / (cnt[0] || 1), sum[1] / (cnt[1] || 1), sum[2] / (cnt[2] || 1), lineBuf, x * 3);
        }
        for (let ox = 0; ox < outW; ox++)
          for (let dx = 0; dx < k; dx++) {
            const s = (ox * k + dx) * 3;
            accum[ox * 3] += lineBuf[s];
            accum[ox * 3 + 1] += lineBuf[s + 1];
            accum[ox * 3 + 2] += lineBuf[s + 2];
          }
      }
      for (let i = 0; i < accum.length; i++) rowOut[i] = accum[i] * norm;
      sink(oy, rowOut, outW);
    }
    return geo;
  }

  // Full-resolution demosaic over a 5-row window of padded, normalised rows.
  const pad = 2;
  const rows: Float32Array[] = Array.from({ length: 5 }, () => new Float32Array(rw + pad * 2));
  const tags = [-100, -100, -100, -100, -100];
  const getRow = (yy: number): Float32Array => {
    const ry = reflect(yy, rh);
    const slot = ((ry % 5) + 5) % 5;
    if (tags[slot] !== ry) {
      const buf = rows[slot];
      for (let p = 0; p < rw + pad * 2; p++) {
        const rx = reflect(p - pad, rw);
        buf[p] = luts[cell(rx, ry)][data[(y0 + ry) * stride + x0 + rx]];
      }
      tags[slot] = ry;
    }
    return rows[slot];
  };
  const high = settings.demosaic === "high";

  const demosaicRow = (y: number, dest: Float32Array): void => {
    const a = getRow(y - 2);
    const b = getRow(y - 1);
    const c = getRow(y);
    const d = getRow(y + 1);
    const e = getRow(y + 2);
    for (let x = 0; x < rw; x++) {
      const i = x + pad;
      const n = cell(x, y);
      const col = cellColor[n];
      const C = c[i];
      let r: number;
      let g: number;
      let bl: number;
      if (!high) {
        if (col === 1) {
          const rowIsRed = cellColor[n ^ 1] === 0;
          const horiz = (c[i - 1] + c[i + 1]) * 0.5;
          const vert = (b[i] + d[i]) * 0.5;
          g = C;
          r = rowIsRed ? horiz : vert;
          bl = rowIsRed ? vert : horiz;
        } else {
          g = (b[i] + d[i] + c[i - 1] + c[i + 1]) * 0.25;
          const diag = (b[i - 1] + b[i + 1] + d[i - 1] + d[i + 1]) * 0.25;
          if (col === 0) {
            r = C;
            bl = diag;
          } else {
            bl = C;
            r = diag;
          }
        }
      } else if (col === 1) {
        const rowIsRed = cellColor[n ^ 1] === 0;
        const diag4 = b[i - 1] + b[i + 1] + d[i - 1] + d[i + 1];
        const rowEst = (5 * C + 4 * (c[i - 1] + c[i + 1]) - (c[i - 2] + c[i + 2]) - diag4 + 0.5 * (a[i] + e[i])) * 0.125;
        const colEst = (5 * C + 4 * (b[i] + d[i]) - (a[i] + e[i]) - diag4 + 0.5 * (c[i - 2] + c[i + 2])) * 0.125;
        g = C;
        r = rowIsRed ? rowEst : colEst;
        bl = rowIsRed ? colEst : rowEst;
      } else {
        g = (4 * C + 2 * (b[i] + d[i] + c[i - 1] + c[i + 1]) - (a[i] + e[i] + c[i - 2] + c[i + 2])) * 0.125;
        const diag = (6 * C + 2 * (b[i - 1] + b[i + 1] + d[i - 1] + d[i + 1]) - 1.5 * (a[i] + e[i] + c[i - 2] + c[i + 2])) * 0.125;
        if (col === 0) {
          r = C;
          bl = diag;
        } else {
          bl = C;
          r = diag;
        }
      }
      finish(r < 0 ? 0 : r, g < 0 ? 0 : g, bl < 0 ? 0 : bl, dest, x * 3);
    }
  };

  for (let oy = 0; oy < outH; oy++) {
    accum.fill(0);
    for (let j = 0; j < k; j++) {
      demosaicRow(oy * k + j, lineBuf);
      for (let ox = 0; ox < outW; ox++)
        for (let dx = 0; dx < k; dx++) {
          const s = (ox * k + dx) * 3;
          accum[ox * 3] += lineBuf[s];
          accum[ox * 3 + 1] += lineBuf[s + 1];
          accum[ox * 3 + 2] += lineBuf[s + 2];
        }
    }
    for (let i = 0; i < accum.length; i++) rowOut[i] = accum[i] * norm;
    sink(oy, rowOut, outW);
  }
  return geo;
}

/** Scene-linear development (exposure applied, no shoulder, no clamp): the float image HDR working modes read. */
export function developRawLinear(raw: DngRaw, settings: RawSourceSettings, options: DevelopOptions = {}): LinearFrame {
  const probe = planGeometry(raw, settings, options);
  const w = probe.swap ? probe.outH : probe.outW;
  const h = probe.swap ? probe.outW : probe.outH;
  const rgb = new Float32Array(w * h * 3);
  developRows(raw, settings, options, (y, row, width) => {
    for (let x = 0; x < width; x++) {
      const [dx, dy] = orientPixel(raw.orientation, x, y, probe.outW, probe.outH);
      const o = (dy * w + dx) * 3;
      rgb[o] = row[x * 3];
      rgb[o + 1] = row[x * 3 + 1];
      rgb[o + 2] = row[x * 3 + 2];
    }
  });
  return { width: w, height: h, rgb };
}

const OETF_STEPS = 4096;
let oetfLut: Uint8Array | null = null;
/** sRGB OETF of linear 0..1 as an 8-bit code, tabulated on sqrt(linear) for resolution near black. */
function encode8(linear: number): number {
  if (!oetfLut) {
    oetfLut = new Uint8Array(OETF_STEPS + 1);
    for (let i = 0; i <= OETF_STEPS; i++) {
      const root = i / OETF_STEPS;
      oetfLut[i] = Math.round(linearToSrgb(root * root) * 255);
    }
  }
  const v = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  return oetfLut[Math.round(Math.sqrt(v) * OETF_STEPS)];
}

/** The hue-preserving highlight shoulder (identity when `knee` is 1). */
export function shoulderLuminance(y: number, knee: number): number {
  if (knee >= 1 || y <= knee) return y;
  const range = 1 - knee;
  return knee + range * (1 - Math.exp(-(y - knee) / range));
}

/** Develops to display-referred 8-bit RGBA (sRGB transfer in the settings' output primaries). */
export function developRaw(raw: DngRaw, settings: RawSourceSettings, options: DevelopOptions = {}): DevelopedFrame {
  const probe = planGeometry(raw, settings, options);
  const w = probe.swap ? probe.outH : probe.outW;
  const h = probe.swap ? probe.outW : probe.outH;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const luma = outputSpaceMatrices(settings.outputColorSpace).lumaRow;
  const knee = 1 - (1 - SHOULDER_KNEE_AT_FULL_RECOVERY) * settings.highlightRecovery;
  developRows(raw, settings, options, (y, row, width) => {
    for (let x = 0; x < width; x++) {
      let r = row[x * 3];
      let g = row[x * 3 + 1];
      let b = row[x * 3 + 2];
      if (knee < 1) {
        const lum = luma[0] * r + luma[1] * g + luma[2] * b;
        if (lum > knee) {
          const s = shoulderLuminance(lum, knee) / lum;
          r *= s;
          g *= s;
          b *= s;
        }
      }
      const [dx, dy] = orientPixel(raw.orientation, x, y, probe.outW, probe.outH);
      const o = (dy * w + dx) * 4;
      rgba[o] = encode8(r);
      rgba[o + 1] = encode8(g);
      rgba[o + 2] = encode8(b);
      rgba[o + 3] = 255;
    }
  });
  return { width: w, height: h, rgba };
}
