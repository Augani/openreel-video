/**
 * Scene edit detection beyond hard cuts: cross-dissolves and fades to / from black.
 *
 * Two passes over the source, both through the same async frame sampler as hard-cut detection:
 *
 * 1. A coarse pass (default 5 fps) finds where the picture changes at all. Hard-cut candidates come
 *    from the existing adaptive finder (`findCuts`); steps whose small-thumbnail distance stands out
 *    from the clip's noise floor (or drifts over a few samples, for slow fades) open a dense window.
 * 2. Inside each window every frame is sampled and classified frame-accurately: runs of near-identical
 *    frames are "holds", and what lies between two holds is one transition. A blend of the two holds
 *    (`(1 - a) * A + a * B`, which a cross-dissolve and a fade to black both are) is fitted per frame; a
 *    good fit gives the exact start/end frames from `a`, and one frame of change is a hard cut. A bad fit
 *    (camera motion, a third shot) is not reported.
 *
 * Pure and framework-free so it runs unchanged in a worker (see scene-detection-worker.ts, which runs it off the main thread).
 */
import {
  buildSceneRanges,
  computeFrameSignature,
  createAbortError,
  findCuts,
  sensitivityToThresholds,
  signatureDistance,
  type FrameLike,
  type FrameSampler,
  type FrameSignature,
  type SceneCut,
  type SceneDetectionProgress,
  type SceneRange,
} from "./scene-detection";

export interface TransitionRange {
  /** Time of the last frame still fully the outgoing picture (seconds). */
  readonly start: number;
  /** Time of the first frame fully the incoming picture (seconds). */
  readonly end: number;
  /** Change between the two pictures in [0, 1]. */
  readonly score: number;
}

export interface FadeRange extends TransitionRange {
  /** "out" fades the picture to black, "in" fades up from black. */
  readonly direction: "out" | "in";
}

/** One scene edit, whatever its kind, ordered on the timeline. */
export interface SceneEdit {
  readonly kind: "cut" | "dissolve" | "fade-through-black" | "fade-out" | "fade-in";
  /** Where a cut / marker belongs: the cut itself, or the middle of a transition. */
  readonly time: number;
  /** Start and end of the transition (equal to `time` for a hard cut). */
  readonly start: number;
  readonly end: number;
  readonly score: number;
}

export interface TransitionDetectionOptions {
  readonly sampler: FrameSampler;
  readonly startTime: number;
  readonly endTime: number;
  /** Frame rate of the source; the dense pass steps at this rate. Default 30. */
  readonly frameRate?: number;
  /** Coarse sampling rate in samples per second. Default 5. */
  readonly sampleRate?: number;
  /** 0 (few edits) .. 1 (many edits). Default 0.5. */
  readonly sensitivity?: number;
  /** Minimum scene length in seconds. Default 0.5. */
  readonly minSceneLength?: number;
  readonly detectDissolves?: boolean;
  readonly detectFades?: boolean;
  /** Longest transition reported, in seconds. Default 4. */
  readonly maxTransitionSeconds?: number;
  /** Cap on densely sampled frames so noisy footage cannot decode the whole clip frame by frame. Default 9000. */
  readonly maxDenseFrames?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: SceneDetectionProgress) => void;
}

export interface TransitionDetectionResult {
  readonly cuts: SceneCut[];
  readonly dissolves: TransitionRange[];
  readonly fades: FadeRange[];
  /** Every edit above in time order, with a fade-out directly followed by a fade-in merged into one. */
  readonly edits: SceneEdit[];
  readonly scenes: SceneRange[];
  readonly samplesAnalysed: number;
}

/** A frame reduced to what the classifier needs. */
export interface DenseFrame {
  readonly time: number;
  readonly signature: FrameSignature;
  readonly vector: Float32Array;
}

export type DenseTransition =
  | { readonly kind: "cut"; readonly time: number; readonly score: number }
  | {
      readonly kind: "dissolve" | "fade-out" | "fade-in";
      readonly start: number;
      readonly end: number;
      readonly score: number;
    };

const GRID_W = 16;
const GRID_H = 9;
const VECTOR_LENGTH = GRID_W * GRID_H * 3;
/** Frames closer than this (RMS, 0..1 pixel values) to a run's first frame are the same picture. */
const HOLD_EPS = 0.006;
const MIN_HOLD_FRAMES = 3;
/** A pair of holds closer than this is no transition. */
const MIN_CHANGE = 0.05;
/** A hold whose mean level is below this is black. */
const BLACK_LEVEL = 0.04;
const START_ALPHA = 0.03;
const END_ALPHA = 0.97;
/** Worst per-frame distance from the A-to-B blend, relative to the A-to-B distance, for a transition to be a blend. */
const MAX_BLEND_RESIDUAL = 0.3;
const MIN_TRANSITION_FRAMES = 3;

/** Averages the frame into a 16x9 grid of RGB means, values in 0..1. */
export function computeFrameVector(frame: FrameLike): Float32Array {
  const { data, width, height } = frame;
  const out = new Float32Array(VECTOR_LENGTH);
  if (width <= 0 || height <= 0) return out;
  const counts = new Float32Array(GRID_W * GRID_H);
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)));
  for (let y = 0; y < height; y += stride) {
    const gy = Math.min(GRID_H - 1, Math.floor((y / height) * GRID_H));
    for (let x = 0; x < width; x += stride) {
      const gx = Math.min(GRID_W - 1, Math.floor((x / width) * GRID_W));
      const cell = gy * GRID_W + gx;
      const i = (y * width + x) * 4;
      out[cell * 3] += data[i];
      out[cell * 3 + 1] += data[i + 1];
      out[cell * 3 + 2] += data[i + 2];
      counts[cell]++;
    }
  }
  for (let cell = 0; cell < counts.length; cell++) {
    const n = counts[cell] * 255;
    if (n > 0) for (let c = 0; c < 3; c++) out[cell * 3 + c] /= n;
  }
  return out;
}

function rms(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum / a.length);
}

function level(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  return sum / v.length;
}

function meanVector(frames: readonly DenseFrame[], from: number, to: number): Float32Array {
  const out = new Float32Array(VECTOR_LENGTH);
  const count = Math.max(1, to - from + 1);
  for (let f = from; f <= to; f++) for (let i = 0; i < out.length; i++) out[i] += frames[f].vector[i] / count;
  return out;
}

/** Runs of at least MIN_HOLD_FRAMES frames that stay within HOLD_EPS of the run's first frame. */
function findHolds(frames: readonly DenseFrame[]): Array<[number, number]> {
  const holds: Array<[number, number]> = [];
  let i = 0;
  while (i < frames.length) {
    let j = i;
    while (j + 1 < frames.length && rms(frames[j + 1].vector, frames[i].vector) <= HOLD_EPS) j++;
    if (j - i + 1 >= MIN_HOLD_FRAMES) {
      holds.push([i, j]);
      i = j + 1;
    } else {
      i++;
    }
  }
  return holds;
}

/**
 * Classifies one densely sampled window into hard cuts, dissolves and fades. Frames must be consecutive
 * source frames. The first and last frame of the window count as holds, so a transition that runs up
 * to the window edge is still measured against that edge frame.
 */
export function classifyDenseWindow(
  frames: readonly DenseFrame[],
  options: { cutFloor: number; minTransitionFrames?: number; dissolves?: boolean; fades?: boolean } = { cutFloor: 0.2 },
): DenseTransition[] {
  const n = frames.length;
  if (n < 2) return [];
  const minFrames = options.minTransitionFrames ?? MIN_TRANSITION_FRAMES;
  const holds = findHolds(frames);
  if (holds.length === 0 || holds[0][0] > 0) holds.unshift([0, 0]);
  if (holds[holds.length - 1][1] < n - 1) holds.push([n - 1, n - 1]);

  const found: DenseTransition[] = [];
  for (let k = 0; k + 1 < holds.length; k++) {
    const [aFrom, aTo] = holds[k];
    const [bFrom, bTo] = holds[k + 1];
    // The incoming hold's first frames are the pure incoming picture, so the transition ends at its head.
    const last = bFrom;
    const A = meanVector(frames, aFrom, Math.min(aTo, aFrom + 1));
    const B = meanVector(frames, bFrom, Math.min(bTo, bFrom + 1));
    const D = rms(A, B);
    if (D < MIN_CHANGE) continue;

    // Position of each frame along the A to B line, and how far it sits off that line.
    const dx = new Float32Array(VECTOR_LENGTH);
    let dd = 0;
    for (let i = 0; i < VECTOR_LENGTH; i++) {
      dx[i] = B[i] - A[i];
      dd += dx[i] * dx[i];
    }
    const alpha: number[] = [];
    let worstResidual = 0;
    let worstRegression = 0;
    let peak = 0;
    for (let f = aFrom; f <= last; f++) {
      const v = frames[f].vector;
      let dot = 0;
      for (let i = 0; i < VECTOR_LENGTH; i++) dot += (v[i] - A[i]) * dx[i];
      const a = dd > 0 ? dot / dd : 0;
      let res = 0;
      for (let i = 0; i < VECTOR_LENGTH; i++) {
        const e = v[i] - (A[i] + a * dx[i]);
        res += e * e;
      }
      worstResidual = Math.max(worstResidual, Math.sqrt(res / VECTOR_LENGTH) / D);
      worstRegression = Math.max(worstRegression, peak - a);
      peak = Math.max(peak, a);
      alpha.push(a);
    }

    // Frames [aFrom..bTo] map to alpha[0..]. Start: last frame still the outgoing picture.
    let startIdx = 0;
    let endIdx = alpha.length - 1;
    for (let i = 0; i < alpha.length; i++) if (alpha[i] < START_ALPHA) startIdx = i;
    for (let i = 0; i < alpha.length; i++) if (alpha[i] < END_ALPHA) endIdx = i + 1;
    endIdx = Math.min(alpha.length - 1, Math.max(endIdx, startIdx + 1));
    const start = aFrom + startIdx;
    const end = aFrom + endIdx;

    const cutAt = (): void => {
      // The frame after the single largest step is the first frame of the new picture.
      let at = start + 1;
      let best = -1;
      for (let f = Math.max(1, start + 1); f <= end; f++) {
        const step = rms(frames[f - 1].vector, frames[f].vector);
        if (step > best) {
          best = step;
          at = f;
        }
      }
      const score = signatureDistance(frames[at - 1].signature, frames[at].signature);
      if (score >= options.cutFloor) found.push({ kind: "cut", time: frames[at].time, score });
    };

    const blend = worstResidual <= MAX_BLEND_RESIDUAL && worstRegression <= 0.15;
    if (end - start < minFrames) {
      // One to two frames of change: a hard cut, if the step really carries the change.
      let biggest = 0;
      for (let f = Math.max(1, start + 1); f <= end; f++)
        biggest = Math.max(biggest, rms(frames[f - 1].vector, frames[f].vector));
      if (blend || biggest >= 0.6 * D) cutAt();
      continue;
    }
    if (!blend) continue;

    const score = signatureDistance(frames[aFrom].signature, frames[bFrom].signature);
    const aBlack = level(A) < BLACK_LEVEL;
    const bBlack = level(B) < BLACK_LEVEL;
    const kind = bBlack && !aBlack ? "fade-out" : aBlack && !bBlack ? "fade-in" : "dissolve";
    if (kind === "dissolve" && options.dissolves === false) continue;
    if (kind !== "dissolve" && options.fades === false) continue;
    if (kind === "dissolve" && score < options.cutFloor * 0.5) continue;
    found.push({ kind, start: frames[start].time, end: frames[end].time, score: Math.max(score, D) });
  }
  return found;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

/** Merges a fade-out directly followed by a fade-in (through black) into one edit. */
export function buildSceneEdits(
  cuts: readonly SceneCut[],
  dissolves: readonly TransitionRange[],
  fades: readonly FadeRange[],
  maxBlackSeconds = 3,
): SceneEdit[] {
  const edits: SceneEdit[] = [];
  for (const c of cuts) edits.push({ kind: "cut", time: c.time, start: c.time, end: c.time, score: c.score });
  for (const d of dissolves)
    edits.push({ kind: "dissolve", time: (d.start + d.end) / 2, start: d.start, end: d.end, score: d.score });
  const sorted = [...fades].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const next = sorted[i + 1];
    if (f.direction === "out" && next && next.direction === "in" && next.start - f.end <= maxBlackSeconds) {
      edits.push({
        kind: "fade-through-black",
        time: (f.end + next.start) / 2,
        start: f.start,
        end: next.end,
        score: Math.max(f.score, next.score),
      });
      i++;
    } else {
      edits.push({
        kind: f.direction === "out" ? "fade-out" : "fade-in",
        time: f.direction === "out" ? f.end : f.start,
        start: f.start,
        end: f.end,
        score: f.score,
      });
    }
  }
  return edits.sort((a, b) => a.time - b.time);
}

export async function detectSceneTransitions(
  options: TransitionDetectionOptions,
): Promise<TransitionDetectionResult> {
  const {
    sampler,
    startTime,
    endTime,
    frameRate = 30,
    sampleRate = 5,
    sensitivity = 0.5,
    minSceneLength = 0.5,
    maxTransitionSeconds = 4,
    maxDenseFrames = 9000,
    signal,
    onProgress,
  } = options;
  const detectDissolves = options.detectDissolves ?? true;
  const detectFades = options.detectFades ?? true;

  throwIfAborted(signal);
  const duration = endTime - startTime;
  const empty: TransitionDetectionResult = { cuts: [], dissolves: [], fades: [], edits: [], scenes: [], samplesAnalysed: 0 };
  if (!(duration > 0) || !(sampleRate > 0) || !(frameRate > 0)) return empty;
  const { floor } = sensitivityToThresholds(sensitivity);
  const frameLen = 1 / frameRate;

  // Pass 1: coarse series.
  const interval = 1 / sampleRate;
  const total = Math.max(2, Math.floor(duration / interval) + 1);
  const times: number[] = [];
  const signatures: FrameSignature[] = [];
  const vectors: Float32Array[] = [];
  const distances: number[] = [];
  const vdist: number[] = [];
  const report = (fraction: number, time: number): void =>
    onProgress?.({ processed: Math.round(fraction * 1000), total: 1000, fraction, time });
  for (let n = 0; n < total; n++) {
    throwIfAborted(signal);
    const t = Math.min(startTime + n * interval, endTime);
    const frame = await sampler(t);
    throwIfAborted(signal);
    if (frame) {
      const signature = computeFrameSignature(frame);
      const vector = computeFrameVector(frame);
      const prev = signatures.length - 1;
      times.push(t);
      distances.push(prev >= 0 ? signatureDistance(signatures[prev], signature) : 0);
      vdist.push(prev >= 0 ? rms(vectors[prev], vector) : 0);
      signatures.push(signature);
      vectors.push(vector);
    }
    report(0.4 * ((n + 1) / total), t);
  }
  if (signatures.length < 2) return { ...empty, samplesAnalysed: signatures.length };

  const coarseCuts = findCuts(distances, times, signatures, { sensitivity, minSceneLength, windowSize: 12 });
  const cutIndexes = new Set<number>();
  for (const c of coarseCuts) cutIndexes.add(times.indexOf(c.time));

  // Flag the steps worth a dense look: a cut candidate, a step above the noise floor, or a slow drift.
  const noise = median(vdist.slice(1));
  const stepThreshold = Math.max(0.012, noise * 4);
  const flagged: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const drift = i >= 4 ? rms(vectors[i - 4], vectors[i]) : 0;
    if (cutIndexes.has(i) || vdist[i] > stepThreshold || drift > 0.05) flagged.push(i);
  }

  // Windows: one coarse sample of padding each side, merged, within the dense-frame budget.
  const pad = interval;
  type Win = { from: number; to: number; peak: number };
  let windows: Win[] = [];
  for (const i of flagged) {
    const from = Math.max(startTime, times[i - 1] - pad);
    const to = Math.min(endTime, times[i] + pad);
    const last = windows[windows.length - 1];
    if (last && from <= last.to + 1e-9) {
      last.to = Math.max(last.to, to);
      last.peak = Math.max(last.peak, vdist[i]);
    } else windows.push({ from, to, peak: vdist[i] });
  }
  let budget = maxDenseFrames;
  windows = [...windows]
    .sort((a, b) => b.peak - a.peak)
    .filter((w) => {
      const cost = Math.ceil((w.to - w.from) * frameRate) + 1;
      if (cost > budget) return false;
      budget -= cost;
      return true;
    })
    .sort((a, b) => a.from - b.from);

  // Pass 2: dense classification inside each window.
  const cuts: SceneCut[] = [];
  const dissolves: TransitionRange[] = [];
  const fades: FadeRange[] = [];
  const maxFrames = Math.round(maxTransitionSeconds * frameRate);
  for (let w = 0; w < windows.length; w++) {
    const win = windows[w];
    const first = Math.floor((win.from - startTime) * frameRate + 1e-6);
    const last = Math.ceil((win.to - startTime) * frameRate - 1e-6);
    const dense: DenseFrame[] = [];
    for (let f = first; f <= last; f++) {
      throwIfAborted(signal);
      const t = startTime + f * frameLen;
      if (t > endTime + 1e-9) break;
      // Sample a quarter frame in so a decoder never lands on the previous frame at an exact boundary.
      const frame = await sampler(t + frameLen * 0.25);
      throwIfAborted(signal);
      if (frame) dense.push({ time: t, signature: computeFrameSignature(frame), vector: computeFrameVector(frame) });
    }
    report(0.4 + 0.6 * ((w + 1) / windows.length), win.to);

    const found = classifyDenseWindow(dense, { cutFloor: floor, dissolves: detectDissolves, fades: detectFades });
    const gradualOk = (s: number, e: number): boolean => Math.round((e - s) * frameRate) <= maxFrames;
    let any = false;
    for (const tr of found) {
      if (tr.kind === "cut") {
        cuts.push({ time: tr.time, score: tr.score });
        any = true;
      } else if (gradualOk(tr.start, tr.end)) {
        any = true;
        if (tr.kind === "dissolve") dissolves.push({ start: tr.start, end: tr.end, score: tr.score });
        else fades.push({ start: tr.start, end: tr.end, score: tr.score, direction: tr.kind === "fade-out" ? "out" : "in" });
      }
    }
    if (!any && dense.length > 1) {
      // The coarse pass saw a cut here and the dense pass found no structured transition (a noisy source,
      // for instance): keep the single largest frame step, like the bisecting hard-cut refinement.
      const hasCoarseCut = coarseCuts.some((c) => c.time >= win.from - 1e-9 && c.time <= win.to + 1e-9);
      if (hasCoarseCut) {
        let at = 1;
        let best = -1;
        for (let f = 1; f < dense.length; f++) {
          const d = signatureDistance(dense[f - 1].signature, dense[f].signature);
          if (d > best) {
            best = d;
            at = f;
          }
        }
        if (best >= floor) cuts.push({ time: dense[at].time, score: best });
      }
    }
  }

  // Hard cuts keep the existing minimum scene length rule (strongest of two close cuts wins).
  cuts.sort((a, b) => a.time - b.time);
  const kept: SceneCut[] = [];
  for (const c of cuts) {
    if (c.time - startTime < minSceneLength - 1e-9 || endTime - c.time < minSceneLength - 1e-9) continue;
    const prev = kept[kept.length - 1];
    if (prev && c.time - prev.time < minSceneLength) {
      if (c.score > prev.score) kept[kept.length - 1] = c;
      continue;
    }
    kept.push(c);
  }
  dissolves.sort((a, b) => a.start - b.start);
  fades.sort((a, b) => a.start - b.start);
  const edits = buildSceneEdits(kept, dissolves, fades);
  const inside = edits.filter((e) => e.time > startTime && e.time < endTime);
  return {
    cuts: kept,
    dissolves,
    fades,
    edits,
    scenes: buildSceneRanges(
      inside.map((e) => ({ time: e.time, score: e.score })),
      startTime,
      endTime,
    ),
    samplesAnalysed: signatures.length,
  };
}
