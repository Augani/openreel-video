import { FLOW_CONSTANTS, flowParamsFor, type FlowParams } from "./types";
import type { RGBAFrame } from "./frame-blend";

/**
 * Dense optical flow + motion-compensated interpolation, CPU reference.
 *
 * Pipeline (each stage is mirrored one for one by the WGSL kernels in optical-flow-wgsl.ts):
 *  1. luma of both frames, box-downsampled by an integer factor to the flow resolution;
 *  2. a Gaussian-ish (2x2 box) pyramid; per level coarse to fine: warped, windowed Lucas-Kanade updates
 *     (A -> B and B -> A, so the field is bidirectional) followed by a 3x3 median to keep motion edges;
 *  3. forward/backward consistency -> a per pixel confidence for each direction (occlusions fail it);
 *  4. synthesis at full resolution for any instant t in (0, 1): the flow is projected to t by fixed-point
 *     iteration, each frame is sampled bilinearly at its motion-compensated position, the two directions are
 *     averaged by confidence x photometric agreement and a plain blend takes over where both are unsure.
 */

export interface FlowPair {
  /** Flow resolution. */
  readonly width: number;
  readonly height: number;
  /** Full-resolution pixels per flow pixel. */
  readonly factor: number;
  /** Interleaved (dx, dy) in flow pixels: A -> B and B -> A. */
  readonly ab: Float32Array;
  readonly ba: Float32Array;
  /** 0..1 forward/backward consistency of each field. */
  readonly confAB: Float32Array;
  readonly confBA: Float32Array;
}

export function flowFactor(width: number, height: number, params: FlowParams): number {
  return Math.max(1, Math.ceil(Math.max(width, height) / params.maxDim));
}

/** Luma (0..1) averaged over factor x factor blocks, clamped at the edges. */
export function lumaDownsample(frame: RGBAFrame, factor: number): { data: Float32Array; width: number; height: number } {
  const w = Math.ceil(frame.width / factor);
  const h = Math.ceil(frame.height / factor);
  const out = new Float32Array(w * h);
  const d = frame.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      const y1 = Math.min(frame.height, (y + 1) * factor);
      const x1 = Math.min(frame.width, (x + 1) * factor);
      for (let yy = y * factor; yy < y1; yy++) {
        for (let xx = x * factor; xx < x1; xx++) {
          const i = (yy * frame.width + xx) * 4;
          sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          count++;
        }
      }
      out[y * w + x] = sum / (count * 255);
    }
  }
  return { data: out, width: w, height: h };
}

interface Plane {
  data: Float32Array;
  width: number;
  height: number;
}

function halve(src: Plane): Plane {
  const w = Math.max(1, Math.ceil(src.width / 2));
  const h = Math.max(1, Math.ceil(src.height / 2));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(src.width - 1, x * 2);
      const x1 = Math.min(src.width - 1, x * 2 + 1);
      const y0 = Math.min(src.height - 1, y * 2);
      const y1 = Math.min(src.height - 1, y * 2 + 1);
      out[y * w + x] =
        (src.data[y0 * src.width + x0] + src.data[y0 * src.width + x1] + src.data[y1 * src.width + x0] + src.data[y1 * src.width + x1]) * 0.25;
    }
  }
  return { data: out, width: w, height: h };
}

export function pyramidLevels(width: number, height: number, wanted: number): number {
  let levels = 1;
  let w = width;
  let h = height;
  while (levels < wanted && Math.min(w, h) >= 32) {
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
    levels++;
  }
  return levels;
}

/** (I - local mean) / max(local deviation, eps): the flow no longer reads a fade or a flicker as motion. */
function normalizePlane(src: Plane): Plane {
  const { width: w, height: h } = src;
  const r = FLOW_CONSTANTS.normRadius;
  const eps2 = FLOW_CONSTANTS.normEps * FLOW_CONSTANTS.normEps;
  const taps = (2 * r + 1) * (2 * r + 1);
  const hs = new Float32Array(w * h);
  const hq = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let q = 0;
      for (let k = -r; k <= r; k++) {
        const v = src.data[y * w + clampi(x + k, 0, w - 1)];
        s += v;
        q += v * v;
      }
      hs[y * w + x] = s;
      hq[y * w + x] = q;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let q = 0;
      for (let k = -r; k <= r; k++) {
        const yy = clampi(y + k, 0, h - 1);
        s += hs[yy * w + x];
        q += hq[yy * w + x];
      }
      const mean = s / taps;
      const variance = Math.max(0, q / taps - mean * mean);
      out[y * w + x] = (src.data[y * w + x] - mean) / Math.sqrt(variance + eps2);
    }
  }
  return { data: out, width: w, height: h };
}

function buildPyramid(base: Plane, levels: number): Plane[] {
  const raw = [base];
  for (let i = 1; i < levels; i++) raw.push(halve(raw[i - 1]));
  return raw.map(normalizePlane);
}

const clampi = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Bilinear sample, pixel centres at integer coordinates, clamped at the border. */
function bil(p: Plane, x: number, y: number): number {
  const xc = clampi(x, 0, p.width - 1);
  const yc = clampi(y, 0, p.height - 1);
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const x1 = Math.min(p.width - 1, x0 + 1);
  const y1 = Math.min(p.height - 1, y0 + 1);
  const fx = xc - x0;
  const fy = yc - y0;
  const d = p.data;
  const w = p.width;
  const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx;
  const bot = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

function at(p: Plane, x: number, y: number): number {
  return p.data[clampi(y, 0, p.height - 1) * p.width + clampi(x, 0, p.width - 1)];
}

/** Coarse flow (2 channels) to the next finer level: bilinear, vectors doubled. */
function upsampleFlow(flow: Float32Array, cw: number, ch: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = clampi((x + 0.5) / 2 - 0.5, 0, cw - 1);
      const v = clampi((y + 0.5) / 2 - 0.5, 0, ch - 1);
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(cw - 1, x0 + 1);
      const y1 = Math.min(ch - 1, y0 + 1);
      const fx = u - x0;
      const fy = v - y0;
      for (let c = 0; c < 2; c++) {
        const top = flow[(y0 * cw + x0) * 2 + c] * (1 - fx) + flow[(y0 * cw + x1) * 2 + c] * fx;
        const bot = flow[(y1 * cw + x0) * 2 + c] * (1 - fx) + flow[(y1 * cw + x1) * 2 + c] * fx;
        out[(y * w + x) * 2 + c] = (top * (1 - fy) + bot * fy) * 2;
      }
    }
  }
  return out;
}

/** One warped Lucas-Kanade update of `flow` (in place) at one pyramid level. */
function refine(A: Plane, B: Plane, flow: Float32Array, radius: number): void {
  const { width: w, height: h } = A;
  const n = w * h;
  const prod = new Float32Array(n * 5);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const bx = x + flow[i * 2];
      const by = y + flow[i * 2 + 1];
      const gAx = (at(A, x + 1, y) - at(A, x - 1, y)) * 0.5;
      const gAy = (at(A, x, y + 1) - at(A, x, y - 1)) * 0.5;
      const gBx = (bil(B, bx + 1, by) - bil(B, bx - 1, by)) * 0.5;
      const gBy = (bil(B, bx, by + 1) - bil(B, bx, by - 1)) * 0.5;
      const ix = 0.5 * (gAx + gBx);
      const iy = 0.5 * (gAy + gBy);
      const it = bil(B, bx, by) - A.data[i];
      prod[i * 5] = ix * ix;
      prod[i * 5 + 1] = ix * iy;
      prod[i * 5 + 2] = iy * iy;
      prod[i * 5 + 3] = ix * it;
      prod[i * 5 + 4] = iy * it;
    }
  }
  // separable box sums (clamped border) of the five products
  const tmp = new Float32Array(n * 5);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 5; c++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) s += prod[(y * w + clampi(x + k, 0, w - 1)) * 5 + c];
        tmp[(y * w + x) * 5 + c] = s;
      }
    }
  }
  const taps = (2 * radius + 1) * (2 * radius + 1);
  const lambda = FLOW_CONSTANTS.lambdaPerTap * taps;
  const step = FLOW_CONSTANTS.maxStep;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = [0, 0, 0, 0, 0];
      for (let k = -radius; k <= radius; k++) {
        const yy = clampi(y + k, 0, h - 1);
        for (let c = 0; c < 5; c++) s[c] += tmp[(yy * w + x) * 5 + c];
      }
      const sxx = s[0] + lambda;
      const sxy = s[1];
      const syy = s[2] + lambda;
      const det = sxx * syy - sxy * sxy;
      const dx = -(syy * s[3] - sxy * s[4]) / det;
      const dy = -(sxx * s[4] - sxy * s[3]) / det;
      const i = y * w + x;
      flow[i * 2] += clampi(dx, -step, step);
      flow[i * 2 + 1] += clampi(dy, -step, step);
    }
  }
}

function median9(v: number[]): number {
  v.sort((a, b) => a - b);
  return v[4];
}

function medianFlow(flow: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(flow.length);
  const win = new Array<number>(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 2; c++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            win[k++] = flow[(clampi(y + dy, 0, h - 1) * w + clampi(x + dx, 0, w - 1)) * 2 + c];
          }
        }
        out[(y * w + x) * 2 + c] = median9(win);
      }
    }
  }
  return out;
}

function oneWay(pa: Plane[], pb: Plane[], params: FlowParams): Float32Array {
  const levels = pa.length;
  let flow: Float32Array = new Float32Array(pa[levels - 1].width * pa[levels - 1].height * 2);
  for (let level = levels - 1; level >= 0; level--) {
    const A = pa[level];
    const B = pb[level];
    if (level < levels - 1) {
      const c = pa[level + 1];
      flow = upsampleFlow(flow, c.width, c.height, A.width, A.height);
    }
    for (let it = 0; it < params.iterations; it++) refine(A, B, flow, params.radius);
    flow = medianFlow(flow, A.width, A.height);
  }
  return flow;
}

function flowAt(flow: Float32Array, w: number, h: number, u: number, v: number, out: [number, number]): void {
  const uc = clampi(u, 0, w - 1);
  const vc = clampi(v, 0, h - 1);
  const x0 = Math.floor(uc);
  const y0 = Math.floor(vc);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = uc - x0;
  const fy = vc - y0;
  for (let c = 0; c < 2; c++) {
    const top = flow[(y0 * w + x0) * 2 + c] * (1 - fx) + flow[(y0 * w + x1) * 2 + c] * fx;
    const bot = flow[(y1 * w + x0) * 2 + c] * (1 - fx) + flow[(y1 * w + x1) * 2 + c] * fx;
    out[c] = top * (1 - fy) + bot * fy;
  }
}

/** Windowed matching error of a flow field on the contrast-normalised finest level, mapped to 0..1. */
function matchConfidence(A: Plane, B: Plane, flow: Float32Array): Float32Array {
  const { width: w, height: h } = A;
  const err = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      err[i] = Math.abs(A.data[i] - bil(B, x + flow[i * 2], y + flow[i * 2 + 1]));
    }
  }
  const r = FLOW_CONSTANTS.matchRadius;
  const taps = (2 * r + 1) * (2 * r + 1);
  const rows = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += err[y * w + clampi(x + k, 0, w - 1)];
      rows[y * w + x] = s;
    }
  }
  const out = new Float32Array(w * h);
  const lo = FLOW_CONSTANTS.matchLo;
  const hi = FLOW_CONSTANTS.matchHi;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += rows[clampi(y + k, 0, h - 1) * w + x];
      out[y * w + x] = clampi((hi - s / taps) / (hi - lo), 0, 1);
    }
  }
  return out;
}

function confidence(flowA: Float32Array, flowB: Float32Array, w: number, h: number, match: Float32Array): Float32Array {
  const conf = new Float32Array(w * h);
  const g: [number, number] = [0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const fx = flowA[i * 2];
      const fy = flowA[i * 2 + 1];
      flowAt(flowB, w, h, x + fx, y + fy, g);
      const ex = fx + g[0];
      const ey = fy + g[1];
      const e2 = ex * ex + ey * ey;
      const thr = FLOW_CONSTANTS.consistencyBase + FLOW_CONSTANTS.consistencyRel * (fx * fx + fy * fy + g[0] * g[0] + g[1] * g[1]);
      conf[i] = clampi(2 - e2 / thr, 0, 1) * match[i];
    }
  }
  return conf;
}

/** Bidirectional flow between two frames of equal size, with consistency confidence. */
export function computeFlowPair(a: RGBAFrame, b: RGBAFrame, params: FlowParams = flowParamsFor("medium")): FlowPair {
  if (a.width !== b.width || a.height !== b.height) throw new Error("Optical flow needs frames of the same size");
  const factor = flowFactor(a.width, a.height, params);
  const la = lumaDownsample(a, factor);
  const lb = lumaDownsample(b, factor);
  const levels = pyramidLevels(la.width, la.height, params.levels);
  const pa = buildPyramid(la, levels);
  const pb = buildPyramid(lb, levels);
  const ab = oneWay(pa, pb, params);
  const ba = oneWay(pb, pa, params);
  return {
    width: la.width,
    height: la.height,
    factor,
    ab,
    ba,
    confAB: confidence(ab, ba, la.width, la.height, matchConfidence(pa[0], pb[0], ab)),
    confBA: confidence(ba, ab, la.width, la.height, matchConfidence(pb[0], pa[0], ba)),
  };
}

function bilinearRGBA(f: RGBAFrame, x: number, y: number, out: number[]): void {
  const xc = clampi(x, 0, f.width - 1);
  const yc = clampi(y, 0, f.height - 1);
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const x1 = Math.min(f.width - 1, x0 + 1);
  const y1 = Math.min(f.height - 1, y0 + 1);
  const fx = xc - x0;
  const fy = yc - y0;
  const d = f.data;
  const i00 = (y0 * f.width + x0) * 4;
  const i10 = (y0 * f.width + x1) * 4;
  const i01 = (y1 * f.width + x0) * 4;
  const i11 = (y1 * f.width + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = d[i00 + c] * (1 - fx) + d[i10 + c] * fx;
    const bot = d[i01 + c] * (1 - fx) + d[i11 + c] * fx;
    out[c] = top * (1 - fy) + bot * fy;
  }
}

function confAt(conf: Float32Array, w: number, h: number, u: number, v: number): number {
  const uc = clampi(u, 0, w - 1);
  const vc = clampi(v, 0, h - 1);
  const x0 = Math.floor(uc);
  const y0 = Math.floor(vc);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = uc - x0;
  const fy = vc - y0;
  const top = conf[y0 * w + x0] * (1 - fx) + conf[y0 * w + x1] * fx;
  const bot = conf[y1 * w + x0] * (1 - fx) + conf[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

/** The frame at instant t (0 = a, 1 = b) of the pair, by motion-compensated sampling of both frames. */
export function synthesizeFrame(a: RGBAFrame, b: RGBAFrame, flow: FlowPair, t: number, out?: Uint8ClampedArray): Uint8ClampedArray {
  const { width: W, height: H } = a;
  const result = out ?? new Uint8ClampedArray(W * H * 4);
  const f = flow.factor;
  const k = FLOW_CONSTANTS;
  const fv: [number, number] = [0, 0];
  const c0 = [0, 0, 0, 0];
  const c1 = [0, 0, 0, 0];
  const c2 = [0, 0, 0, 0];
  const c3 = [0, 0, 0, 0];
  const colF = [0, 0, 0, 0];
  const colB = [0, 0, 0, 0];
  const colZ = [0, 0, 0, 0];
  const sigma2 = k.photometricSigma * k.photometricSigma;
  const diff = (p: number[], q: number[]): number => (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / (3 * 255);
  let dZero = 0;
  const photometric = (p: number[], q: number[]): number => {
    const d = diff(p, q);
    const gate = clampi((k.gateRatio - d / (dZero + 0.02)) / k.gateSoftness, 0, 1);
    return Math.exp(-(d * d) / sigma2) * gate;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      bilinearRGBA(a, x, y, c0);
      bilinearRGBA(b, x, y, c1);
      dZero = diff(c0, c1);
      for (let c = 0; c < 4; c++) colZ[c] = c0[c] * (1 - t) + c1[c] * t;

      // forward candidate: x + t * Fab(x) = p
      let px = x;
      let py = y;
      for (let it = 0; it < k.fixedPointIterations; it++) {
        flowAt(flow.ab, flow.width, flow.height, (px + 0.5) / f - 0.5, (py + 0.5) / f - 0.5, fv);
        px = x - t * fv[0] * f;
        py = y - t * fv[1] * f;
      }
      flowAt(flow.ab, flow.width, flow.height, (px + 0.5) / f - 0.5, (py + 0.5) / f - 0.5, fv);
      const fdx = fv[0] * f;
      const fdy = fv[1] * f;
      const cf = confAt(flow.confAB, flow.width, flow.height, (px + 0.5) / f - 0.5, (py + 0.5) / f - 0.5);
      bilinearRGBA(a, x - t * fdx, y - t * fdy, c0);
      bilinearRGBA(b, x + (1 - t) * fdx, y + (1 - t) * fdy, c1);
      const wf = cf * photometric(c0, c1);
      for (let c = 0; c < 4; c++) colF[c] = c0[c] * (1 - t) + c1[c] * t;

      // backward candidate: y + (1 - t) * Fba(y) = p
      px = x;
      py = y;
      for (let it = 0; it < k.fixedPointIterations; it++) {
        flowAt(flow.ba, flow.width, flow.height, (px + 0.5) / f - 0.5, (py + 0.5) / f - 0.5, fv);
        px = x - (1 - t) * fv[0] * f;
        py = y - (1 - t) * fv[1] * f;
      }
      flowAt(flow.ba, flow.width, flow.height, (px + 0.5) / f - 0.5, (py + 0.5) / f - 0.5, fv);
      const bdx = fv[0] * f;
      const bdy = fv[1] * f;
      const cb = confAt(flow.confBA, flow.width, flow.height, (px + 0.5) / f - 0.5, (py + 0.5) / f - 0.5);
      bilinearRGBA(b, x - (1 - t) * bdx, y - (1 - t) * bdy, c2);
      bilinearRGBA(a, x + t * bdx, y + t * bdy, c3);
      const wb = cb * photometric(c3, c2);
      for (let c = 0; c < 4; c++) colB[c] = c3[c] * (1 - t) + c2[c] * t;

      const wz = k.blendFloor;
      const inv = 1 / (wf + wb + wz);
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v = (wf * colF[c] + wb * colB[c] + wz * colZ[c]) * inv;
        result[o + c] = Math.round(v);
      }
    }
  }
  return result;
}

/** Convenience: flow + synthesis for one instant. */
export function interpolateOpticalFlowCPU(a: RGBAFrame, b: RGBAFrame, t: number, params: FlowParams = flowParamsFor("medium")): Uint8ClampedArray {
  return synthesizeFrame(a, b, computeFlowPair(a, b, params), t);
}

/**
 * computeFlowPair with a hand-back to the event loop between its stages (the two directions, then the
 * confidences), so a long analysis on the CPU keeps the page responsive and can report progress. Same pixels as
 * computeFlowPair.
 */
export async function computeFlowPairStaged(
  a: RGBAFrame,
  b: RGBAFrame,
  params: FlowParams,
  onStage?: (done: number, total: number) => void,
): Promise<FlowPair> {
  if (a.width !== b.width || a.height !== b.height) throw new Error("Optical flow needs frames of the same size");
  const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const factor = flowFactor(a.width, a.height, params);
  const la = lumaDownsample(a, factor);
  const lb = lumaDownsample(b, factor);
  const levels = pyramidLevels(la.width, la.height, params.levels);
  const pa = buildPyramid(la, levels);
  const pb = buildPyramid(lb, levels);
  onStage?.(0, 4);
  await yieldToLoop();
  const ab = oneWay(pa, pb, params);
  onStage?.(1, 4);
  await yieldToLoop();
  const ba = oneWay(pb, pa, params);
  onStage?.(2, 4);
  await yieldToLoop();
  const confAB = confidence(ab, ba, la.width, la.height, matchConfidence(pa[0], pb[0], ab));
  onStage?.(3, 4);
  await yieldToLoop();
  const confBA = confidence(ba, ab, la.width, la.height, matchConfidence(pb[0], pa[0], ba));
  onStage?.(4, 4);
  return { width: la.width, height: la.height, factor, ab, ba, confAB, confBA };
}
