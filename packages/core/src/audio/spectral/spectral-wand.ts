/**
 * Magic wand for the spectrogram: click a time-frequency point and select the connected region of similar energy.
 *
 * The analysis is the edit STFT (2048 / 512). Power is smoothed over 3 x 3 cells so the Rayleigh fluctuation of a noise floor
 * does not shatter the selection, then converted to dB. From the clicked cell (snapped to the loudest of its 3 x 3 neighbours
 * so a click one bin off a tone still lands on it) an 8-connected flood fill takes every cell whose level is within the
 * tolerance of the seed:
 *
 *   level mode     |L - L(seed)| <= toleranceDb. Selects a patch of one loudness: a tone line, a click, a noise burst.
 *   contrast mode  how far a cell stands above its own surroundings (L minus the mean level of a +-LOCAL_BINS x +-LOCAL_FRAMES
 *                  neighbourhood) is within toleranceDb of the seed's, one-sided (a more prominent cell connected to the seed
 *                  is kept). Follows a ridge such as a whistle or hum whose absolute level wanders, and ignores the floor.
 *
 * The result is stored as a run-length cell mask on the STFT grid (see SpectralWandMask), never recomputed when rendering.
 */
import { MAX_WAND_CELLS, MAX_WAND_RUNS, SPECTRAL_WAND_VERSION, type SpectralPoint, type SpectralWandMask } from "./spectral-regions";
import { analyseFrame, getStftPlan, stftFrameRange } from "./spectral-stft";

export const DEFAULT_WAND_TOLERANCE_DB = 6;
/** Neighbourhood (cells each side) whose mean level is the "surroundings" of contrast mode. */
const LOCAL_BINS = 10;
const LOCAL_FRAMES = 8;
/** Contrast mode also requires the cell to be no more than this many tolerances below the seed's level (a silent patch has no contrast to follow). */
const CONTRAST_FLOOR_TOLERANCES = 2;
/** Frames analysed each side of the seed. */
const DEFAULT_WAND_SECONDS = 20;

export interface WandOptions {
  readonly toleranceDb?: number;
  readonly localContrast?: boolean;
  /** Seconds each side of the seed that are analysed (the selection cannot grow past them). */
  readonly maxSeconds?: number;
}

export type WandResult =
  | { readonly ok: true; readonly wand: SpectralWandMask; readonly cells: number; readonly seedCell: { readonly m: number; readonly k: number } }
  | { readonly ok: false; readonly reason: "empty" | "too-large" | "fragmented" | "out-of-range" };

/** Run-length encodes a frame-major byte mask (alternating off, on, off ...; starts with off). */
export function encodeRuns(bits: Uint8Array): number[] {
  const runs: number[] = [];
  let state = 0;
  let count = 0;
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] === state) count += 1;
    else {
      runs.push(count);
      state = state ? 0 : 1;
      count = 1;
    }
  }
  runs.push(count);
  return runs;
}

export function computeMagicWand(signal: Float32Array, sampleRate: number, seed: SpectralPoint, options: WandOptions = {}): WandResult {
  const plan = getStftPlan();
  const { size, hop } = plan;
  const half = size / 2;
  const binHz = sampleRate / size;
  const toleranceDb = Math.max(0.1, Math.min(60, options.toleranceDb ?? DEFAULT_WAND_TOLERANCE_DB));
  const contrast = options.localContrast === true;
  const range = stftFrameRange(signal.length, plan);
  const lastFrame = Math.max(0, range.last);
  const seedFrame = Math.round((seed.t * sampleRate - half) / hop);
  const seedBin = Math.round(seed.hz / binHz);
  if (signal.length === 0 || seedFrame < 0 || seedFrame > lastFrame || seedBin < 0 || seedBin > half) return { ok: false, reason: "out-of-range" };
  const span = Math.ceil(((options.maxSeconds ?? DEFAULT_WAND_SECONDS) * sampleRate) / hop);
  const m0 = Math.max(0, seedFrame - span);
  const m1 = Math.min(lastFrame, seedFrame + span);
  const rows = m1 - m0 + 1;
  const cols = half + 1;
  if (rows * cols > 12_000_000) return { ok: false, reason: "too-large" };

  const power = new Float32Array(rows * cols);
  const scratch = new Float32Array(size);
  for (let r = 0; r < rows; r += 1) {
    const { real, imag } = analyseFrame(plan, signal, (m0 + r) * hop, scratch);
    for (let k = 0; k < cols; k += 1) power[r * cols + k] = real[k] * real[k] + imag[k] * imag[k];
  }
  // 3 x 3 mean power -> dB (power, not magnitude: a noise floor keeps its level).
  const level = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r += 1) {
    for (let k = 0; k < cols; k += 1) {
      let sum = 0;
      let n = 0;
      for (let dr = -1; dr <= 1; dr += 1) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dk = -1; dk <= 1; dk += 1) {
          const kk = k + dk;
          if (kk < 0 || kk >= cols) continue;
          sum += power[rr * cols + kk];
          n += 1;
        }
      }
      level[r * cols + k] = 10 * Math.log10(sum / n + 1e-20);
    }
  }
  // Seed: the loudest cell of the clicked cell's 3 x 3 neighbourhood.
  let sr = seedFrame - m0;
  let sk = seedBin;
  let best = -Infinity;
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dk = -1; dk <= 1; dk += 1) {
      const rr = seedFrame - m0 + dr;
      const kk = seedBin + dk;
      if (rr < 0 || rr >= rows || kk < 0 || kk >= cols) continue;
      if (level[rr * cols + kk] > best) {
        best = level[rr * cols + kk];
        sr = rr;
        sk = kk;
      }
    }
  }
  let score: Float32Array = level;
  if (contrast) {
    // Integral image of the dB levels gives each cell's neighbourhood mean in O(1).
    const w = cols + 1;
    const integral = new Float64Array((rows + 1) * w);
    for (let r = 0; r < rows; r += 1) {
      let rowSum = 0;
      for (let k = 0; k < cols; k += 1) {
        rowSum += level[r * cols + k];
        integral[(r + 1) * w + k + 1] = integral[r * w + k + 1] + rowSum;
      }
    }
    score = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r += 1) {
      const r0 = Math.max(0, r - LOCAL_FRAMES);
      const r1 = Math.min(rows - 1, r + LOCAL_FRAMES);
      for (let k = 0; k < cols; k += 1) {
        const k0 = Math.max(0, k - LOCAL_BINS);
        const k1 = Math.min(cols - 1, k + LOCAL_BINS);
        const total = integral[(r1 + 1) * w + k1 + 1] - integral[r0 * w + k1 + 1] - integral[(r1 + 1) * w + k0] + integral[r0 * w + k0];
        score[r * cols + k] = level[r * cols + k] - total / ((r1 - r0 + 1) * (k1 - k0 + 1));
      }
    }
  }
  const seedScore = score[sr * cols + sk];
  const seedLevel = level[sr * cols + sk];
  const accept = (i: number): boolean =>
    contrast ? score[i] >= seedScore - toleranceDb && level[i] >= seedLevel - CONTRAST_FLOOR_TOLERANCES * toleranceDb : Math.abs(score[i] - seedScore) <= toleranceDb;

  const picked = new Uint8Array(rows * cols);
  const stack = new Int32Array(rows * cols);
  let top = 0;
  let count = 0;
  stack[top++] = sr * cols + sk;
  picked[sr * cols + sk] = 1;
  let rMin = sr;
  let rMax = sr;
  let kMin = sk;
  let kMax = sk;
  while (top > 0) {
    const i = stack[--top];
    count += 1;
    if (count > MAX_WAND_CELLS / 2) return { ok: false, reason: "too-large" };
    const r = (i / cols) | 0;
    const k = i - r * cols;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
    for (let dr = -1; dr <= 1; dr += 1) {
      const rr = r + dr;
      if (rr < 0 || rr >= rows) continue;
      for (let dk = -1; dk <= 1; dk += 1) {
        const kk = k + dk;
        if (kk < 0 || kk >= cols || (dr === 0 && dk === 0)) continue;
        const j = rr * cols + kk;
        if (picked[j] || !accept(j)) continue;
        picked[j] = 1;
        stack[top++] = j;
      }
    }
  }
  if (count === 0) return { ok: false, reason: "empty" };
  const frames = rMax - rMin + 1;
  const bins = kMax - kMin + 1;
  const bits = new Uint8Array(frames * bins);
  for (let r = 0; r < frames; r += 1) for (let k = 0; k < bins; k += 1) bits[r * bins + k] = picked[(rMin + r) * cols + kMin + k];
  const runs = encodeRuns(bits);
  if (runs.length > MAX_WAND_RUNS || frames * bins > MAX_WAND_CELLS) return { ok: false, reason: "fragmented" };
  return {
    ok: true,
    cells: count,
    seedCell: { m: m0 + sr, k: sk },
    wand: { version: SPECTRAL_WAND_VERSION, seed: { t: seed.t, hz: seed.hz }, toleranceDb, localContrast: contrast, sampleRate, fftSize: size, hop, m0: m0 + rMin, k0: kMin, frames, bins, runs },
  };
}

/** Why a wand click selected nothing, in words for a person. */
export const wandFailureMessage = (reason: Extract<WandResult, { ok: false }>["reason"]): string =>
  reason === "out-of-range"
    ? "That point is outside the audio."
    : reason === "too-large"
      ? "The selection grew too large. Lower the tolerance or turn on local contrast."
      : reason === "fragmented"
        ? "The selection is too fragmented to store. Lower the tolerance or turn on local contrast."
        : "Nothing there to select.";
