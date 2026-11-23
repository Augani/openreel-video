import type { Lut1D, Lut3D } from "./luts";

/**
 * The runtime op model. A transform from the config (or from a builtin) is flattened into a list of ops; the CPU
 * evaluator below and the GLSL generator (`glsl.ts`) both read this list, so they cannot disagree about what a
 * transform means. Direction is resolved when the list is built: `invertOps` reverses the order and flips each op.
 *
 * All arithmetic is on three channels; alpha is never touched (OCIO's own alpha-using paths, such as a matrix row that
 * mixes alpha into colour, are reported when the config is compiled, not evaluated).
 */

export type V3 = readonly [number, number, number];
export type NegStyle = "clamp" | "mirror" | "pass";

export type FixedStyle =
  | "ACES_RedMod10"
  | "ACES_Glow03"
  | "ACES_Glow10"
  | "ACES_DarkToDim10"
  | "ACES_GamutComp13"
  | "REC2100_Surround"
  | "RGB_TO_HSV"
  | "XYZ_TO_xyY"
  | "XYZ_TO_uvY"
  | "XYZ_TO_LUV";

export type AnalyticId =
  | "pq_oetf" // linear (1.0 = 100 nit) to the PQ signal
  | "pq_eotf"
  | "hlg_oetf" // scene linear (0..1) to the HLG signal
  | "hlg_oetf_inv"
  | "acescc_decode"
  | "aces13_sdr_video" // ACES2065-1 to XYZ D65 (1.0 = 100 nit), ACES 1.3 RRT + SDR video ODT
  | "aces13_hdr_1000_rec2020"; // ACES2065-1 to XYZ D65 (1.0 = 100 nit), 1000 nit / 15 nit, Rec.2020 limited

export type Op =
  | { readonly k: "mat"; readonly m: readonly number[]; readonly o: V3 }
  | { readonly k: "exp"; readonly g: V3; readonly style: NegStyle; readonly inv: boolean }
  | { readonly k: "explin"; readonly g: V3; readonly off: V3; readonly style: "linear" | "mirror"; readonly inv: boolean }
  | {
      readonly k: "log";
      readonly base: number;
      readonly ls: V3;
      readonly lo: V3;
      readonly ns: V3;
      readonly no: V3;
      readonly brk: V3 | null;
      readonly lslope: V3 | null;
      readonly inv: boolean;
    }
  | { readonly k: "cdl"; readonly slope: V3; readonly offset: V3; readonly power: V3; readonly sat: number; readonly noclamp: boolean; readonly inv: boolean }
  | {
      readonly k: "range";
      readonly minIn: number | null;
      readonly maxIn: number | null;
      readonly minOut: number | null;
      readonly maxOut: number | null;
      readonly noclamp: boolean;
      readonly inv: boolean;
    }
  | { readonly k: "fixed"; readonly style: FixedStyle; readonly params: readonly number[]; readonly inv: boolean }
  | { readonly k: "lut1d"; readonly lut: Lut1D; readonly inv: boolean }
  | { readonly k: "lut3d"; readonly lut: Lut3D; readonly tetra: boolean }
  | { readonly k: "analytic"; readonly id: AnalyticId };

export class OcioUnsupportedError extends Error {}

const FIXED_NAMES: Readonly<Record<string, FixedStyle>> = {
  acesredmod10: "ACES_RedMod10",
  acesglow03: "ACES_Glow03",
  acesglow10: "ACES_Glow10",
  acesdarktodim10: "ACES_DarkToDim10",
  acesgamutcomp13: "ACES_GamutComp13",
  rec2100surround: "REC2100_Surround",
  rgbtohsv: "RGB_TO_HSV",
  xyztoxyy: "XYZ_TO_xyY",
  xyztouvy: "XYZ_TO_uvY",
  xyztoluv: "XYZ_TO_LUV",
};

/** Fixed function style by its config spelling (`ACES_RedMod03`) or OCIO enum spelling (`ACES_RED_MOD_03`). */
export function fixedStyleOf(name: string): FixedStyle | null {
  return FIXED_NAMES[name.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? null;
}

export const FLT_MIN = 1.17549435e-38;

// -- helpers -------------------------------------------------------------------------------------------------------------

export function invertMatrix3(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) throw new OcioUnsupportedError("A matrix in the config is singular and cannot be inverted.");
  const s = 1 / det;
  return [A * s, -(b * i - c * h) * s, (b * f - c * e) * s, B * s, (a * i - c * g) * s, -(a * f - c * d) * s, C * s, -(a * h - b * g) * s, (a * e - b * d) * s];
}

export function mulMat3(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
}

export function invertOp(op: Op): Op {
  switch (op.k) {
    case "mat": {
      const mi = invertMatrix3(op.m);
      return { k: "mat", m: mi, o: [-(mi[0] * op.o[0] + mi[1] * op.o[1] + mi[2] * op.o[2]), -(mi[3] * op.o[0] + mi[4] * op.o[1] + mi[5] * op.o[2]), -(mi[6] * op.o[0] + mi[7] * op.o[1] + mi[8] * op.o[2])] };
    }
    case "exp":
    case "explin":
    case "log":
    case "cdl":
    case "fixed":
    case "lut1d":
      return { ...op, inv: !op.inv } as Op;
    case "range": {
      // The inverse maps the output interval back to the input one.
      if (op.noclamp) return { ...op, minIn: op.minOut, maxIn: op.maxOut, minOut: op.minIn, maxOut: op.maxIn, inv: false };
      return { ...op, minIn: op.minOut, maxIn: op.maxOut, minOut: op.minIn, maxOut: op.maxIn, inv: false };
    }
    case "lut3d":
      throw new OcioUnsupportedError("The inverse of a 3D LUT needs an iterative solve and is not evaluated.");
    case "analytic": {
      const pairs: Partial<Record<AnalyticId, AnalyticId>> = { pq_oetf: "pq_eotf", pq_eotf: "pq_oetf", hlg_oetf: "hlg_oetf_inv", hlg_oetf_inv: "hlg_oetf" };
      const inv = pairs[op.id];
      if (inv) return { k: "analytic", id: inv };
      throw new OcioUnsupportedError(`The inverse of the built-in "${op.id}" is not evaluated.`);
    }
  }
}

export function invertOps(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  for (let i = ops.length - 1; i >= 0; i--) out.push(invertOp(ops[i]));
  return out;
}

// -- CPU evaluation ------------------------------------------------------------------------------------------------------

const PQ_M1 = 0.1593017578125;
const PQ_M2 = 78.84375;
const PQ_C1 = 0.8359375;
const PQ_C2 = 18.8515625;
const PQ_C3 = 18.6875;

export function pqEotfNorm(e: number): number {
  const p = Math.pow(Math.max(e, 0), 1 / PQ_M2);
  return Math.pow(Math.max(p - PQ_C1, 0) / (PQ_C2 - PQ_C3 * p), 1 / PQ_M1);
}

export function pqOetfNorm(y: number): number {
  const p = Math.pow(Math.max(y, 0), PQ_M1);
  return Math.pow((PQ_C1 + PQ_C2 * p) / (1 + PQ_C3 * p), PQ_M2);
}

const HLG_A = 0.17883277;
const HLG_B = 0.28466892;
const HLG_C = 0.55991073;

export function hlgOetf(e: number): number {
  const v = Math.max(e, 0);
  return v <= 1 / 12 ? Math.sqrt(3 * v) : HLG_A * Math.log(12 * v - HLG_B) + HLG_C;
}

export function hlgOetfInv(s: number): number {
  const v = Math.max(s, 0);
  return v <= 0.5 ? (v * v) / 3 : (Math.exp((v - HLG_C) / HLG_A) + HLG_B) / 12;
}

function expOne(x: number, g: number, style: NegStyle): number {
  if (style === "mirror") return x < 0 ? -Math.pow(-x, g) : Math.pow(x, g);
  if (style === "pass") return x < 0 ? x : Math.pow(x, g);
  return x < 0 ? 0 : Math.pow(x, g);
}

function explinOne(x: number, g: number, off: number, style: "linear" | "mirror", inv: boolean): number {
  if (off <= 0) return expOne(x, inv ? 1 / g : g, style === "mirror" ? "mirror" : "clamp");
  if (style === "mirror" && x < 0) return -explinOne(-x, g, off, style, inv);
  // Forward is encoded -> linear (the sRGB decode): ((x + off) / (1 + off))^g above the break, x / slope below it.
  const slope = Math.pow((g - 1) / off, g - 1) * Math.pow((1 + off) / g, g);
  const brk = off / (g - 1);
  if (!inv) return x >= brk ? Math.pow((x + off) / (1 + off), g) : x / slope;
  return x >= brk / slope ? (1 + off) * Math.pow(x, 1 / g) - off : x * slope;
}

export interface LogResolved {
  readonly base: number;
  readonly ls: number;
  readonly lo: number;
  readonly ns: number;
  readonly no: number;
  readonly brk: number | null;
  readonly linearSlope: number;
  readonly linearOffset: number;
  readonly logBrk: number;
}

export function resolveLog(op: Extract<Op, { k: "log" }>, ch: 0 | 1 | 2): LogResolved {
  const ln = Math.log(op.base);
  const ls = op.ls[ch];
  const lo = op.lo[ch];
  const ns = op.ns[ch];
  const no = op.no[ch];
  if (op.brk === null) return { base: op.base, ls, lo, ns, no, brk: null, linearSlope: 0, linearOffset: 0, logBrk: 0 };
  const brk = op.brk[ch];
  const logAtBreak = ls * (Math.log(Math.max(ns * brk + no, FLT_MIN)) / ln) + lo;
  const linearSlope = op.lslope ? op.lslope[ch] : (ls * ns) / ((ns * brk + no) * ln);
  const linearOffset = logAtBreak - linearSlope * brk;
  return { base: op.base, ls, lo, ns, no, brk, linearSlope, linearOffset, logBrk: logAtBreak };
}

function logOne(x: number, p: LogResolved, inv: boolean): number {
  const ln = Math.log(p.base);
  if (!inv) {
    if (p.brk !== null && x < p.brk) return p.linearSlope * x + p.linearOffset;
    return p.ls * (Math.log(Math.max(p.ns * x + p.no, FLT_MIN)) / ln) + p.lo;
  }
  if (p.brk !== null && x < p.logBrk) return (x - p.linearOffset) / p.linearSlope;
  return (Math.exp(((x - p.lo) / p.ls) * ln) - p.no) / p.ns;
}

const LUMA: V3 = [0.2126, 0.7152, 0.0722];

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function cdlApply(c: number[], op: Extract<Op, { k: "cdl" }>): void {
  const { slope, offset, power, sat, noclamp } = op;
  const pw = (x: number, p: number): number => (noclamp ? (x < 0 ? x : Math.pow(x, p)) : Math.pow(x, p));
  const cl = (x: number): number => (noclamp ? x : clamp01(x));
  if (!op.inv) {
    for (let i = 0; i < 3; i++) c[i] = pw(cl(c[i] * slope[i] + offset[i]), power[i]);
    // Note: the ASC clamp applies after slope and offset, so `cl` ran first.
    const luma = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
    for (let i = 0; i < 3; i++) c[i] = cl(luma + sat * (c[i] - luma));
    return;
  }
  for (let i = 0; i < 3; i++) c[i] = cl(c[i]);
  const luma = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  for (let i = 0; i < 3; i++) c[i] = cl(luma + (c[i] - luma) / sat);
  for (let i = 0; i < 3; i++) c[i] = cl((pw(c[i], 1 / power[i]) - offset[i]) / slope[i]);
}

function rangeApply(c: number[], op: Extract<Op, { k: "range" }>): void {
  const { minIn, maxIn, minOut, maxOut } = op;
  const scaling = minIn !== null && maxIn !== null && minOut !== null && maxOut !== null;
  if (scaling) {
    const scale = (maxOut - minOut) / (maxIn - minIn);
    const offset = minOut - minIn * scale;
    for (let i = 0; i < 3; i++) c[i] = c[i] * scale + offset;
  }
  if (op.noclamp) return;
  // Clamp: the lower bound is the output's minimum, the upper the output's maximum (when only the inputs are given, those).
  const lo = minOut ?? (scaling ? null : minIn);
  const hi = maxOut ?? (scaling ? null : maxIn);
  for (let i = 0; i < 3; i++) {
    if (lo !== null && c[i] < lo) c[i] = lo;
    if (hi !== null && c[i] > hi) c[i] = hi;
  }
}

export function lut1dSample(lut: Lut1D, x: number, ch: number): number {
  const n = lut.size;
  const pos = Math.min(Math.max(x, 0), 1) * (n - 1);
  const i0 = Math.min(Math.floor(pos), n - 2);
  const f = pos - i0;
  const a = lut.data[i0 * 3 + ch];
  const b = lut.data[(i0 + 1) * 3 + ch];
  return a + (b - a) * f;
}

/**
 * The effective domain of a 1D table for inversion, as OpenColorIO computes it: indices of the last entry of the leading
 * flat run and the first entry of the trailing flat run. Values beyond the table's range invert to those entries (not to
 * the ends of the domain), because a flat end has no unique inverse.
 */
export function lut1dFlatEnds(lut: Lut1D, ch: number): { start: number; end: number } {
  const n = lut.size;
  const d = lut.data;
  let start = 0;
  while (start < n - 1 && d[(start + 1) * 3 + ch] === d[ch]) start++;
  let end = n - 1;
  while (end > start && d[(end - 1) * 3 + ch] === d[(n - 1) * 3 + ch]) end--;
  return { start, end };
}

/** Inverse of a monotone 1D table (increasing or decreasing) by search and linear interpolation, clamped to the table's effective domain. */
export function lut1dInverse(lut: Lut1D, y: number, ch: number): number {
  const n = lut.size;
  const d = lut.data;
  const first = d[ch];
  const last = d[(n - 1) * 3 + ch];
  const increasing = last >= first;
  const { start, end } = lut1dFlatEnds(lut, ch);
  if (increasing ? y <= first : y >= first) return start / (n - 1);
  if (increasing ? y >= last : y <= last) return end / (n - 1);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const v = d[mid * 3 + ch];
    if (increasing ? v <= y : v >= y) lo = mid;
    else hi = mid;
  }
  const a = d[lo * 3 + ch];
  const b = d[hi * 3 + ch];
  const f = b === a ? 0 : (y - a) / (b - a);
  return (lo + f) / (n - 1);
}

export function lut3dSample(lut: Lut3D, rgb: readonly [number, number, number], tetra: boolean, out: number[]): void {
  const n = lut.size;
  const d = lut.data;
  const p = [0, 0, 0];
  const i0 = [0, 0, 0];
  const f = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    p[c] = Math.min(Math.max(rgb[c], 0), 1) * (n - 1);
    i0[c] = Math.min(Math.floor(p[c]), n - 2);
    f[c] = p[c] - i0[c];
  }
  const idx = (r: number, g: number, b: number): number => (r + n * (g + n * b)) * 3;
  const at = (dr: number, dg: number, db: number, ch: number): number => d[idx(i0[0] + dr, i0[1] + dg, i0[2] + db) + ch];
  const [fr, fg, fb] = f;
  for (let ch = 0; ch < 3; ch++) {
    if (!tetra) {
      const c00 = at(0, 0, 0, ch) * (1 - fr) + at(1, 0, 0, ch) * fr;
      const c10 = at(0, 1, 0, ch) * (1 - fr) + at(1, 1, 0, ch) * fr;
      const c01 = at(0, 0, 1, ch) * (1 - fr) + at(1, 0, 1, ch) * fr;
      const c11 = at(0, 1, 1, ch) * (1 - fr) + at(1, 1, 1, ch) * fr;
      const c0 = c00 * (1 - fg) + c10 * fg;
      const c1 = c01 * (1 - fg) + c11 * fg;
      out[ch] = c0 * (1 - fb) + c1 * fb;
    } else {
      const v000 = at(0, 0, 0, ch);
      const v111 = at(1, 1, 1, ch);
      let v: number;
      if (fr > fg) {
        if (fg > fb) v = (1 - fr) * v000 + (fr - fg) * at(1, 0, 0, ch) + (fg - fb) * at(1, 1, 0, ch) + fb * v111;
        else if (fr > fb) v = (1 - fr) * v000 + (fr - fb) * at(1, 0, 0, ch) + (fb - fg) * at(1, 0, 1, ch) + fg * v111;
        else v = (1 - fb) * v000 + (fb - fr) * at(0, 0, 1, ch) + (fr - fg) * at(1, 0, 1, ch) + fg * v111;
      } else if (fb > fg) v = (1 - fb) * v000 + (fb - fg) * at(0, 0, 1, ch) + (fg - fr) * at(0, 1, 1, ch) + fr * v111;
      else if (fb > fr) v = (1 - fg) * v000 + (fg - fb) * at(0, 1, 0, ch) + (fb - fr) * at(0, 1, 1, ch) + fr * v111;
      else v = (1 - fg) * v000 + (fg - fr) * at(0, 1, 0, ch) + (fr - fb) * at(1, 1, 0, ch) + fb * v111;
      out[ch] = v;
    }
  }
}

export type AnalyticFn = (c: number[]) => void;
const analyticRegistry = new Map<AnalyticId, AnalyticFn>();

/** Builtins that need larger tables (the ACES output transform) register themselves from `builtins-aces.ts`. */
export function registerAnalytic(id: AnalyticId, fn: AnalyticFn): void {
  analyticRegistry.set(id, fn);
}

function acesccDecode(y: number): number {
  if (y < (9.72 - 15) / 17.52) return (Math.pow(2, y * 17.52 - 9.72) - Math.pow(2, -16)) * 2;
  return Math.pow(2, y * 17.52 - 9.72);
}

/** OCIO's half-domain LUTs continue below zero as the mirror image, so the curves are odd functions. */
const odd = (f: (x: number) => number) => (x: number): number => (x < 0 ? -f(-x) : f(x));

const SIMPLE_ANALYTIC: Partial<Record<AnalyticId, (x: number) => number>> = {
  // linear 1.0 = 100 nit: PQ expects absolute nits / 10000.
  pq_oetf: odd((x) => pqOetfNorm((x * 100) / 10000)),
  pq_eotf: odd((x) => (pqEotfNorm(x) * 10000) / 100),
  // The OCIO builtin curve takes scene light with 1.0 = 3 x the HLG reference (it is the BT.2100 OETF of x / 3).
  hlg_oetf: odd((x) => hlgOetf(x / 3)),
  hlg_oetf_inv: odd((y) => 3 * hlgOetfInv(y)),
  acescc_decode: acesccDecode,
};

function evalFixed(c: number[], op: Extract<Op, { k: "fixed" }>): void {
  const fn = FIXED_IMPLS.get(op.style);
  if (!fn) throw new OcioUnsupportedError(`The fixed function ${op.style} is not implemented.`);
  fn(c, op.params, op.inv);
}

export type FixedFn = (c: number[], params: readonly number[], inv: boolean) => void;
const FIXED_IMPLS = new Map<FixedStyle, FixedFn>();
export function registerFixed(style: FixedStyle, fn: FixedFn): void {
  FIXED_IMPLS.set(style, fn);
}
export function hasFixed(style: FixedStyle): boolean {
  return FIXED_IMPLS.has(style);
}

/** Applies one op to `c` (3 channels, in place). */
export function applyOp(op: Op, c: number[]): void {
  switch (op.k) {
    case "mat": {
      const [r, g, b] = c;
      const m = op.m;
      c[0] = m[0] * r + m[1] * g + m[2] * b + op.o[0];
      c[1] = m[3] * r + m[4] * g + m[5] * b + op.o[1];
      c[2] = m[6] * r + m[7] * g + m[8] * b + op.o[2];
      return;
    }
    case "exp":
      for (let i = 0; i < 3; i++) c[i] = expOne(c[i], op.inv ? 1 / op.g[i] : op.g[i], op.style);
      return;
    case "explin":
      for (let i = 0; i < 3; i++) c[i] = explinOne(c[i], op.g[i], op.off[i], op.style, op.inv);
      return;
    case "log":
      for (let i = 0; i < 3; i++) c[i] = logOne(c[i], resolveLog(op, i as 0 | 1 | 2), op.inv);
      return;
    case "cdl":
      cdlApply(c, op);
      return;
    case "range":
      rangeApply(c, op);
      return;
    case "fixed":
      evalFixed(c, op);
      return;
    case "lut1d":
      for (let i = 0; i < 3; i++) c[i] = op.inv ? lut1dInverse(op.lut, c[i], i) : lut1dSample(op.lut, c[i], i);
      return;
    case "lut3d": {
      lut3dSample(op.lut, [c[0], c[1], c[2]], op.tetra, c);
      return;
    }
    case "analytic": {
      const simple = SIMPLE_ANALYTIC[op.id];
      if (simple) {
        for (let i = 0; i < 3; i++) c[i] = simple(c[i]);
        return;
      }
      const fn = analyticRegistry.get(op.id);
      if (!fn) throw new OcioUnsupportedError(`The built-in ${op.id} is not loaded.`);
      fn(c);
    }
  }
}

export function applyOps(ops: readonly Op[], c: number[]): void {
  for (const op of ops) applyOp(op, c);
}
