/**
 * Scene (hard cut) detection.
 *
 * Pure-function core: frames are provided through an async sampler, reduced to
 * a small HSV histogram signature, and compared with their predecessor.
 * A cut is reported when the frame-to-frame distance exceeds an adaptive
 * threshold (mean + k * stddev of the preceding distances) and an absolute
 * floor. Gradual changes (fades, dissolves) produce small per-step distances
 * and therefore do not trigger; flashes (two close spikes returning to the
 * same picture) are suppressed by the minimum scene length rule.
 */

export interface FrameLike {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

/** Returns the frame at a source time (seconds), or null if unavailable. */
export type FrameSampler = (time: number) => Promise<FrameLike | null>;

export interface SceneCut {
  /** Source time of the first frame of the new scene, in seconds. */
  readonly time: number;
  /** Frame distance score in [0, 1] at the cut. */
  readonly score: number;
}

export interface SceneRange {
  readonly start: number;
  readonly end: number;
}

export interface SceneDetectionProgress {
  readonly processed: number;
  readonly total: number;
  /** 0..1 */
  readonly fraction: number;
  readonly time: number;
}

export interface SceneDetectionOptions {
  readonly sampler: FrameSampler;
  /** Start of the source range to analyse (seconds). */
  readonly startTime: number;
  /** End of the source range to analyse (seconds). */
  readonly endTime: number;
  /** Sampling rate in frames per second. Default 5. */
  readonly sampleRate?: number;
  /** 0 (few cuts) .. 1 (many cuts). Default 0.5. */
  readonly sensitivity?: number;
  /** Minimum scene length in seconds. Default 0.5. */
  readonly minSceneLength?: number;
  /** Number of previous distances used for the adaptive threshold. Default 12. */
  readonly windowSize?: number;
  /** Refine cut timestamps by bisecting between samples. Default true. */
  readonly refine?: boolean;
  /** Smallest step used while refining (seconds). Default 1/30. */
  readonly refineStep?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: SceneDetectionProgress) => void;
}

export interface SceneDetectionResult {
  readonly cuts: SceneCut[];
  readonly scenes: SceneRange[];
  readonly samplesAnalysed: number;
}

export interface CutFinderOptions {
  readonly sensitivity: number;
  readonly minSceneLength: number;
  readonly windowSize: number;
}

const HUE_BINS = 12;
const SAT_BINS = 4;
const VAL_BINS = 16;
const HIST_LENGTH = HUE_BINS + SAT_BINS + VAL_BINS;
/** Extra trailing slot holding the mean (effective) saturation, i.e. the hue mass. */
const SIGNATURE_LENGTH = HIST_LENGTH + 1;
const HUE_MASS = HIST_LENGTH;
const MAX_SAMPLE_PIXELS = 64 * 64;

export type FrameSignature = Float32Array;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Adds `weight` to a histogram with linear interpolation between bin centres. */
function addSoft(
  sig: FrameSignature,
  offset: number,
  bins: number,
  value: number,
  weight: number,
  circular: boolean,
): void {
  const pos = value * bins - 0.5;
  const lo = Math.floor(pos);
  const frac = pos - lo;
  const wrap = (b: number): number =>
    circular ? ((b % bins) + bins) % bins : clamp(b, 0, bins - 1);
  sig[offset + wrap(lo)] += weight * (1 - frac);
  sig[offset + wrap(lo + 1)] += weight * frac;
}

/**
 * Builds a normalised HSV signature: hue (saturation weighted), saturation and
 * value histograms concatenated, using soft binning. Large frames are strided
 * down to roughly 64x64 samples.
 */
export function computeFrameSignature(frame: FrameLike): FrameSignature {
  const { data, width, height } = frame;
  const sig = new Float32Array(SIGNATURE_LENGTH);
  const pixels = width * height;
  if (pixels <= 0) return sig;

  const stride = Math.max(1, Math.floor(Math.sqrt(pixels / MAX_SAMPLE_PIXELS)));
  let count = 0;
  let hueWeight = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      // Hue/saturation are unreliable for very dark pixels (quantisation noise),
      // so fade saturation out below 20% brightness.
      const s = max === 0 ? 0 : (delta / max) * Math.min(1, max / 0.2);

      let h = 0;
      if (delta > 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h /= 6;
        if (h < 0) h += 1;
      }

      if (s > 0) {
        addSoft(sig, 0, HUE_BINS, h, s, true);
        hueWeight += s;
      }
      addSoft(sig, HUE_BINS, SAT_BINS, s, 1, false);
      addSoft(sig, HUE_BINS + SAT_BINS, VAL_BINS, max, 1, false);
      count++;
    }
  }

  if (count === 0) return sig;
  if (hueWeight > 1e-6) {
    for (let k = 0; k < HUE_BINS; k++) sig[k] /= hueWeight;
  }
  for (let k = HUE_BINS; k < HIST_LENGTH; k++) sig[k] /= count;
  sig[HUE_MASS] = hueWeight / count;
  return sig;
}

/** Earth mover's distance of an ordered histogram, normalised to [0, 1]. */
function orderedEmd(
  a: FrameSignature,
  b: FrameSignature,
  from: number,
  bins: number,
): number {
  let cdf = 0;
  let sum = 0;
  for (let k = 0; k < bins - 1; k++) {
    cdf += a[from + k] - b[from + k];
    sum += Math.abs(cdf);
  }
  return sum / (bins - 1);
}

/** Circular earth mover's distance of the hue histogram, normalised to [0, 1]. */
function circularEmd(a: FrameSignature, b: FrameSignature): number {
  const ma = a[HUE_MASS];
  const mb = b[HUE_MASS];
  const massDiff = 0.5 * Math.abs(ma - mb);
  if (ma < 1e-6 || mb < 1e-6) return massDiff;
  const cdf: number[] = [];
  let acc = 0;
  for (let k = 0; k < HUE_BINS; k++) {
    acc += a[k] - b[k];
    cdf.push(acc);
  }
  const median = [...cdf].sort((x, y) => x - y)[Math.floor(HUE_BINS / 2)];
  let sum = 0;
  for (const v of cdf) sum += Math.abs(v - median);
  return clamp(Math.min(ma, mb) * (sum / (HUE_BINS / 2)) + massDiff, 0, 1);
}

/** Distance between two signatures in [0, 1]. */
export function signatureDistance(a: FrameSignature, b: FrameSignature): number {
  const dh = circularEmd(a, b);
  const ds = orderedEmd(a, b, HUE_BINS, SAT_BINS);
  const dv = orderedEmd(a, b, HUE_BINS + SAT_BINS, VAL_BINS);
  return clamp(dh + ds + dv, 0, 1);
}

/** Maps sensitivity to the stddev multiplier and the absolute distance floor. */
export function sensitivityToThresholds(sensitivity: number): {
  k: number;
  floor: number;
} {
  const s = clamp(sensitivity, 0, 1);
  return { k: 6 - 4 * s, floor: 0.45 - 0.33 * s };
}

interface Candidate {
  /** index of the first sample of the new scene */
  readonly index: number;
  readonly score: number;
}

/**
 * Finds cuts in a series of frame distances.
 * distances[i] is the distance between sample i-1 and sample i (distances[0] is unused).
 * times[i] is the time of sample i. signatures are used to discard flashes.
 */
export function findCuts(
  distances: readonly number[],
  times: readonly number[],
  signatures: readonly FrameSignature[],
  options: CutFinderOptions,
): SceneCut[] {
  const { k, floor } = sensitivityToThresholds(options.sensitivity);
  const windowSize = Math.max(2, Math.floor(options.windowSize));
  const n = distances.length;
  const candidates: Candidate[] = [];
  // Distances that were accepted as cut candidates are excluded from the
  // adaptive window so one spike does not mask the next one.
  const isSpike: boolean[] = new Array<boolean>(n).fill(false);

  for (let i = 1; i < n; i++) {
    const d = distances[i];
    if (d < floor) continue;
    const from = Math.max(1, i - windowSize);
    let sum = 0;
    let sumSq = 0;
    let cnt = 0;
    for (let j = from; j < i; j++) {
      if (isSpike[j]) continue;
      sum += distances[j];
      sumSq += distances[j] * distances[j];
      cnt++;
    }
    let threshold = floor;
    if (cnt > 0) {
      const mean = sum / cnt;
      const variance = Math.max(0, sumSq / cnt - mean * mean);
      threshold = Math.max(floor, mean + k * Math.sqrt(variance));
    }
    if (d < threshold) continue;
    // must be a local peak so a single cut is not reported twice
    if (i + 1 < n && distances[i + 1] > d) continue;
    isSpike[i] = true;
    candidates.push({ index: i, score: d });
  }

  // Flash / min-length suppression.
  let working = candidates.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let c = 0; c < working.length - 1; c++) {
      const a = working[c];
      const b = working[c + 1];
      if (times[b.index] - times[a.index] >= options.minSceneLength) continue;
      const before = signatures[a.index - 1];
      const after = signatures[b.index];
      const sameAround =
        before && after && signatureDistance(before, after) < floor;
      if (sameAround) {
        working = working.filter((_, idx) => idx !== c && idx !== c + 1);
      } else {
        working = working.filter((_, idx) => idx !== (a.score >= b.score ? c + 1 : c));
      }
      changed = true;
      break;
    }
  }

  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? 0;
  return working
    .filter(
      (c) =>
        times[c.index] - first >= options.minSceneLength &&
        last - times[c.index] >= options.minSceneLength,
    )
    .map((c) => ({ time: times[c.index], score: c.score }));
}

export function buildSceneRanges(
  cuts: readonly SceneCut[],
  startTime: number,
  endTime: number,
): SceneRange[] {
  const edges = [startTime, ...cuts.map((c) => c.time), endTime];
  const scenes: SceneRange[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    if (edges[i + 1] > edges[i]) scenes.push({ start: edges[i], end: edges[i + 1] });
  }
  return scenes;
}

export function createAbortError(): Error {
  const err = new Error("Scene detection aborted");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

/** Bisects between two sample times to locate the cut more precisely. */
async function refineCut(
  sampler: FrameSampler,
  left: FrameSignature,
  right: FrameSignature,
  lo: number,
  hi: number,
  step: number,
  signal?: AbortSignal,
): Promise<number> {
  let a = lo;
  let b = hi;
  while (b - a > step) {
    throwIfAborted(signal);
    const mid = (a + b) / 2;
    const frame = await sampler(mid);
    throwIfAborted(signal);
    if (!frame) break;
    const sig = computeFrameSignature(frame);
    if (signatureDistance(sig, left) <= signatureDistance(sig, right)) a = mid;
    else b = mid;
  }
  return b;
}

export async function detectScenes(
  options: SceneDetectionOptions,
): Promise<SceneDetectionResult> {
  const {
    sampler,
    startTime,
    endTime,
    sampleRate = 5,
    sensitivity = 0.5,
    minSceneLength = 0.5,
    windowSize = 12,
    refine = true,
    refineStep = 1 / 30,
    signal,
    onProgress,
  } = options;

  throwIfAborted(signal);
  const duration = endTime - startTime;
  if (!(duration > 0) || !(sampleRate > 0)) {
    return { cuts: [], scenes: [], samplesAnalysed: 0 };
  }

  const interval = 1 / sampleRate;
  const total = Math.max(2, Math.floor(duration / interval) + 1);
  const times: number[] = [];
  const signatures: FrameSignature[] = [];
  const distances: number[] = [];

  for (let n = 0; n < total; n++) {
    throwIfAborted(signal);
    const t = Math.min(startTime + n * interval, endTime);
    const frame = await sampler(t);
    throwIfAborted(signal);
    if (frame) {
      const sig = computeFrameSignature(frame);
      const prev = signatures[signatures.length - 1];
      times.push(t);
      signatures.push(sig);
      distances.push(prev ? signatureDistance(prev, sig) : 0);
    }
    onProgress?.({
      processed: n + 1,
      total,
      fraction: (n + 1) / total,
      time: t,
    });
  }

  throwIfAborted(signal);
  let cuts = findCuts(distances, times, signatures, {
    sensitivity,
    minSceneLength,
    windowSize,
  });

  if (refine && cuts.length > 0) {
    const refined: SceneCut[] = [];
    for (const cut of cuts) {
      const idx = times.indexOf(cut.time);
      if (idx <= 0) {
        refined.push(cut);
        continue;
      }
      const time = await refineCut(
        sampler,
        signatures[idx - 1],
        signatures[idx],
        times[idx - 1],
        times[idx],
        refineStep,
        signal,
      );
      refined.push({ time, score: cut.score });
    }
    cuts = refined;
  }

  throwIfAborted(signal);
  return {
    cuts,
    scenes: buildSceneRanges(cuts, startTime, endTime),
    samplesAnalysed: signatures.length,
  };
}
