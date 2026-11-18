/**
 * Pure table builders shared by every LUT consumer (WebGL grading pass, HDR GPU pass, HDR CPU reference).
 * They always prefer the full-precision float table / exact 1D curve over the clamped 8-bit table, so the
 * preview paths agree with the CPU float reference and with export.
 */

export interface LutCurve1d {
  size: number;
  domainMin: readonly [number, number, number];
  domainMax: readonly [number, number, number];
  /** Interleaved RGB, `size` entries. */
  data: ArrayLike<number>;
}

export interface LutTableSource {
  data: ArrayLike<number>;
  floatData?: ArrayLike<number>;
  curve1d?: LutCurve1d;
  size: number;
}

export function hasFloatTable(lut: Pick<LutTableSource, "floatData" | "size">): boolean {
  const n = lut.size;
  return !!lut.floatData && Number.isInteger(n) && n >= 2 && lut.floatData.length >= n * n * n * 3;
}

export function hasByteTable(lut: Pick<LutTableSource, "data" | "size">): boolean {
  const n = lut.size;
  return Number.isInteger(n) && n >= 2 && lut.data.length >= n * n * n * 3;
}

export function hasCurve1d(curve: LutCurve1d | undefined): curve is LutCurve1d {
  return (
    !!curve &&
    Number.isInteger(curve.size) &&
    curve.size >= 2 &&
    curve.data.length >= curve.size * 3 &&
    [0, 1, 2].every((c) => curve.domainMax[c] > curve.domainMin[c])
  );
}

/** True when the LUT can be applied at all (a usable float table, 8-bit table, or exact 1D curve). */
export function isLutUsable(lut: LutTableSource): boolean {
  return hasFloatTable(lut) || hasByteTable(lut) || hasCurve1d(lut.curve1d);
}

/**
 * size^3 RGB triples (red fastest) in the table's own 0..1 input mapping. Float table when present (unclamped,
 * unquantised), else the 8-bit table scaled to 0..1.
 */
export function resolveLut3dRgb(lut: LutTableSource): Float32Array {
  const count = lut.size * lut.size * lut.size * 3;
  const out = new Float32Array(count);
  if (hasFloatTable(lut)) {
    const src = lut.floatData as ArrayLike<number>;
    for (let i = 0; i < count; i++) out[i] = src[i];
  } else {
    for (let i = 0; i < count; i++) out[i] = lut.data[i] / 255;
  }
  return out;
}

/** RGB triples -> RGBA32F texels (alpha 1), the layout of a float 3D texture upload (x=r, y=g, z=b). */
export function packRgbToRgba(rgb: ArrayLike<number>, texels: number): Float32Array {
  const out = new Float32Array(texels * 4);
  for (let i = 0, o = 0, q = 0; i < texels; i++, o += 4, q += 3) {
    out[o] = rgb[q];
    out[o + 1] = rgb[q + 1];
    out[o + 2] = rgb[q + 2];
    out[o + 3] = 1;
  }
  return out;
}

/** RGBA32F texels for a `size x 1` texture of the exact 1D curve. */
export function packCurve1dRgba(curve: LutCurve1d): Float32Array {
  return packRgbToRgba(curve.data, curve.size);
}

/** Linear interpolation of the exact 1D curve for one channel; input is mapped through the curve's domain. */
export function sampleCurve1dChannel(curve: LutCurve1d, channel: number, value: number): number {
  const m = curve.size - 1;
  let t = (value - curve.domainMin[channel]) / (curve.domainMax[channel] - curve.domainMin[channel]);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const p = t * m;
  const i0 = Math.min(Math.floor(p), m);
  const i1 = Math.min(i0 + 1, m);
  const f = p - i0;
  return curve.data[i0 * 3 + channel] * (1 - f) + curve.data[i1 * 3 + channel] * f;
}

/** Trilinear lookup of a size^3 RGB table, each input channel in 0..1 (clamped). */
export function sampleLut3dRgb(rgb: ArrayLike<number>, size: number, r: number, g: number, b: number): [number, number, number] {
  const max = size - 1;
  const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ri = clamp(r) * max;
  const gi = clamp(g) * max;
  const bi = clamp(b) * max;
  const r0 = Math.floor(ri);
  const g0 = Math.floor(gi);
  const b0 = Math.floor(bi);
  const r1 = Math.min(r0 + 1, max);
  const g1 = Math.min(g0 + 1, max);
  const b1 = Math.min(b0 + 1, max);
  const fr = ri - r0;
  const fg = gi - g0;
  const fb = bi - b0;
  const at = (x: number, y: number, z: number, c: number): number => rgb[(z * size * size + y * size + x) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(r0, g0, b0, c) * (1 - fr) + at(r1, g0, b0, c) * fr;
    const c01 = at(r0, g0, b1, c) * (1 - fr) + at(r1, g0, b1, c) * fr;
    const c10 = at(r0, g1, b0, c) * (1 - fr) + at(r1, g1, b0, c) * fr;
    const c11 = at(r0, g1, b1, c) * (1 - fr) + at(r1, g1, b1, c) * fr;
    out[c] = (c00 * (1 - fg) + c10 * fg) * (1 - fb) + (c01 * (1 - fg) + c11 * fg) * fb;
  }
  return out;
}
