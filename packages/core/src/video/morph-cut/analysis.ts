import type { RGBAFrame } from "../time-interpolation/frame-blend";
import { computeFlowPairStaged, type FlowPair } from "../time-interpolation/optical-flow-cpu";
import type { FlowParams } from "../time-interpolation/types";
import {
  alignFrames,
  applySimilarity,
  downsampleRGBA,
  invertSimilarity,
  similarityRotationDeg,
  similarityScale,
  warpByInverseSimilarity,
  type Similarity,
} from "./alignment";
import {
  MORPH_CUT_CONSTANTS as K,
  MORPH_CUT_FAILED_MESSAGE,
  MORPH_CUT_FLOW,
  type MorphAnalysis,
  type MorphCutQuality,
  type MorphField,
  type MorphMetrics,
} from "./types";

/**
 * Morph Cut analysis of two reference frames (the outgoing clip's last frame, the incoming clip's first frame).
 *
 *  1. both frames are box-downsampled to the analysis size (<= MORPH_CUT_FLOW[quality].maxDim);
 *  2. a global similarity A -> B is fitted from robust feature matches (alignment.ts);
 *  3. B is resampled into A's frame through it and the dense bidirectional flow of Time Interpolation (WebGPU
 *     compute or the CPU reference, the same algorithm and constants) is run on that aligned pair;
 *  4. the residual flow is composed with the similarity into one displacement field per direction, with
 *     confidences that also drop where the alignment leaves the frame;
 *  5. a quality gate decides whether the field is a morph (usable) or the shots are too different (cross dissolve).
 */
export interface DenseFlowResult {
  readonly width: number;
  readonly height: number;
  readonly ab: Float32Array;
  readonly ba: Float32Array;
  readonly confAB: Float32Array;
  readonly confBA: Float32Array;
}

export interface DenseFlowBackend {
  readonly name: "gpu" | "cpu";
  compute(a: RGBAFrame, b: RGBAFrame, params: FlowParams, onStage?: (done: number, total: number) => void): Promise<DenseFlowResult>;
}

const toDense = (pair: FlowPair): DenseFlowResult => ({ width: pair.width, height: pair.height, ab: pair.ab, ba: pair.ba, confAB: pair.confAB, confBA: pair.confBA });

export const cpuDenseBackend: DenseFlowBackend = {
  name: "cpu",
  async compute(a, b, params, onStage) {
    return toDense(await computeFlowPairStaged(a, b, params, onStage));
  },
};

export interface AnalyseOptions {
  readonly key: string;
  readonly quality?: MorphCutQuality;
  readonly backend?: DenseFlowBackend;
  /** 0..1, called as the stages finish. */
  readonly onProgress?: (fraction: number) => void;
  /** Aborting stops the analysis at the next stage boundary; the returned promise rejects with MorphCutCancelled. */
  readonly signal?: AbortSignal;
}

/** Thrown by analyseMorphCut when its signal is aborted. */
export class MorphCutCancelled extends Error {
  constructor() {
    super("Morph Cut analysis cancelled");
    this.name = "MorphCutCancelled";
  }
}

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

function boxFactor(width: number, height: number, maxDim: number): number {
  return Math.max(1, Math.ceil(Math.max(width, height) / maxDim));
}

const clampi = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function bilinear2(field: Float32Array, w: number, h: number, u: number, v: number, out: [number, number]): void {
  const uc = clampi(u, 0, w - 1);
  const vc = clampi(v, 0, h - 1);
  const x0 = Math.floor(uc);
  const y0 = Math.floor(vc);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = uc - x0;
  const fy = vc - y0;
  for (let c = 0; c < 2; c++) {
    const top = field[(y0 * w + x0) * 2 + c] * (1 - fx) + field[(y0 * w + x1) * 2 + c] * fx;
    const bot = field[(y1 * w + x0) * 2 + c] * (1 - fx) + field[(y1 * w + x1) * 2 + c] * fx;
    out[c] = top * (1 - fy) + bot * fy;
  }
}

function bilinear1(field: Float32Array, w: number, h: number, u: number, v: number): number {
  const uc = clampi(u, 0, w - 1);
  const vc = clampi(v, 0, h - 1);
  const x0 = Math.floor(uc);
  const y0 = Math.floor(vc);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = uc - x0;
  const fy = vc - y0;
  const top = field[y0 * w + x0] * (1 - fx) + field[y0 * w + x1] * fx;
  const bot = field[y1 * w + x0] * (1 - fx) + field[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

/**
 * Residual flow (between A and B aligned into A's frame) composed with the similarity S (A -> B) into the true
 * displacement fields, A -> B on A's grid and B -> A on B's grid, in grid pixels.
 */
export function composeFields(residual: DenseFlowResult, s: Similarity, valid: Uint8Array): MorphField {
  const { width: w, height: h } = residual;
  const inv = invertSimilarity(s);
  const ab = new Float32Array(w * h * 2);
  const ba = new Float32Array(w * h * 2);
  const confAB = new Float32Array(w * h);
  const confBA = new Float32Array(w * h);
  const r: [number, number] = [0, 0];
  const inB = (x: number, y: number): boolean => x >= 0 && x <= w - 1 && y >= 0 && y <= h - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // A -> B: A(x) = B'(x + r) = B(S(x + r))
      const rx = residual.ab[i * 2];
      const ry = residual.ab[i * 2 + 1];
      const [bx, by] = applySimilarity(s, x + rx, y + ry);
      ab[i * 2] = bx - x;
      ab[i * 2 + 1] = by - y;
      confAB[i] = inB(bx, by) ? residual.confAB[i] : 0;
      // B -> A: y in B is u = S^-1(y) in the aligned frame, where B'(u) = A(u + r(u))
      const [ux, uy] = applySimilarity(inv, x, y);
      if (inB(ux, uy)) {
        bilinear2(residual.ba, w, h, ux, uy, r);
        ba[i * 2] = ux + r[0] - x;
        ba[i * 2 + 1] = uy + r[1] - y;
        const vi = valid[clampi(Math.round(uy), 0, h - 1) * w + clampi(Math.round(ux), 0, w - 1)];
        confBA[i] = vi ? bilinear1(residual.confBA, w, h, ux, uy) : 0;
      } else {
        // B pixel whose counterpart lies outside A: no motion known, the renderer falls back to the blend there
        ba[i * 2] = 0;
        ba[i * 2 + 1] = 0;
        confBA[i] = 0;
      }
    }
  }
  return { width: w, height: h, ab, ba, confAB, confBA };
}

function colourAt(f: RGBAFrame, x: number, y: number): [number, number, number] {
  const xc = clampi(x, 0, f.width - 1);
  const yc = clampi(y, 0, f.height - 1);
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const x1 = Math.min(f.width - 1, x0 + 1);
  const y1 = Math.min(f.height - 1, y0 + 1);
  const fx = xc - x0;
  const fy = yc - y0;
  const d = f.data;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const top = d[(y0 * f.width + x0) * 4 + c] * (1 - fx) + d[(y0 * f.width + x1) * 4 + c] * fx;
    const bot = d[(y1 * f.width + x0) * 4 + c] * (1 - fx) + d[(y1 * f.width + x1) * 4 + c] * fx;
    out[c] = top * (1 - fy) + bot * fy;
  }
  return out;
}

/** Quality numbers of a finished field and the gate verdict. */
export function judgeField(a: RGBAFrame, b: RGBAFrame, field: MorphField, alignment: { similarity: Similarity; matches: number; inliers: number }): { metrics: MorphMetrics; ok: boolean; reason?: string } {
  const { width: w, height: h } = field;
  const cells = w * h;
  let confident = 0;
  let sum = 0;
  let maxDisp = 0;
  let errAligned = 0;
  let errPlain = 0;
  let weight = 0;
  for (let i = 0; i < cells; i++) {
    const c = (field.confAB[i] + field.confBA[i]) * 0.5;
    sum += c;
    if (c > 0.5) confident++;
    const dx = field.ab[i * 2];
    const dy = field.ab[i * 2 + 1];
    maxDisp = Math.max(maxDisp, Math.hypot(dx, dy));
    if (field.confAB[i] > 0.5) {
      const x = i % w;
      const y = (i / w) | 0;
      const pa = colourAt(a, x, y);
      const pw = colourAt(b, x + dx, y + dy);
      const pp = colourAt(b, x, y);
      errAligned += Math.abs(pa[0] - pw[0]) + Math.abs(pa[1] - pw[1]) + Math.abs(pa[2] - pw[2]);
      errPlain += Math.abs(pa[0] - pp[0]) + Math.abs(pa[1] - pp[1]) + Math.abs(pa[2] - pp[2]);
      weight++;
    }
  }
  const confidentFraction = confident / cells;
  const meanConfidence = sum / cells;
  const alignedErrorRatio = weight === 0 ? 1 : errPlain < 1e-6 ? 0 : errAligned / errPlain;
  const maxDisplacementFraction = maxDisp / Math.hypot(w, h);
  const confidence = Math.max(0, Math.min(1, 0.5 * meanConfidence + 0.5 * Math.min(1, confidentFraction / 0.7)));
  const metrics: MorphMetrics = {
    confidence,
    confidentFraction,
    meanConfidence,
    alignedErrorRatio,
    inliers: alignment.inliers,
    matches: alignment.matches,
    maxDisplacementFraction,
    similarity: { scale: similarityScale(alignment.similarity), rotationDeg: similarityRotationDeg(alignment.similarity), tx: alignment.similarity.tx, ty: alignment.similarity.ty },
  };
  let reason: string | undefined;
  if (confidentFraction < K.minConfidentFraction) reason = "too little of the picture could be matched";
  else if (meanConfidence < K.minMeanConfidence) reason = "the match confidence is too low";
  else if (alignedErrorRatio > K.maxAlignedErrorRatio) reason = "aligning the shots does not make them agree";
  else if (maxDisplacementFraction > K.maxDisplacementFraction) reason = "the shots are too far apart";
  return { metrics, ok: reason === undefined, reason };
}

const failedMetrics = (reason: string): MorphMetrics => {
  void reason;
  return { confidence: 0, confidentFraction: 0, meanConfidence: 0, alignedErrorRatio: 1, inliers: 0, matches: 0, maxDisplacementFraction: 0, similarity: { scale: 1, rotationDeg: 0, tx: 0, ty: 0 } };
};

/** Analyse two same-sized reference frames. Never throws for content reasons: a failure is `ok: false` with a reason. */
export async function analyseMorphCut(a: RGBAFrame, b: RGBAFrame, options: AnalyseOptions): Promise<MorphAnalysis> {
  const started = nowMs();
  const backend = options.backend ?? cpuDenseBackend;
  const quality = options.quality ?? "medium";
  const settings = MORPH_CUT_FLOW[quality];
  const report = options.onProgress ?? (() => undefined);
  const progress = (fraction: number): void => {
    if (options.signal?.aborted) throw new MorphCutCancelled();
    report(fraction);
  };
  progress(0);
  if (a.width !== b.width || a.height !== b.height) {
    return { key: options.key, ok: false, reason: "the two frames differ in size", field: null, metrics: failedMetrics("size"), backend: backend.name, analysisMs: nowMs() - started };
  }
  const factor = boxFactor(a.width, a.height, settings.maxDim);
  const sa = downsampleRGBA(a, factor);
  const sb = downsampleRGBA(b, factor);
  progress(0.05);
  const alignment = alignFrames(sa, sb);
  progress(0.15);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const { frame: aligned, valid } = warpByInverseSimilarity(sb, alignment.similarity);
  const params: FlowParams = { maxDim: Math.max(sa.width, sa.height), levels: settings.levels, iterations: settings.iterations, radius: settings.radius };
  const residual = await backend.compute(sa, aligned, params, (done, total) => progress(0.15 + 0.75 * (done / total)));
  const field = composeFields(residual, alignment.similarity, valid);
  const verdict = judgeField(sa, sb, field, alignment);
  progress(1);
  const analysisMs = nowMs() - started;
  if (!verdict.ok) {
    return { key: options.key, ok: false, reason: verdict.reason ?? MORPH_CUT_FAILED_MESSAGE, field: null, metrics: verdict.metrics, backend: backend.name, analysisMs };
  }
  return { key: options.key, ok: true, field, metrics: verdict.metrics, backend: backend.name, analysisMs };
}
