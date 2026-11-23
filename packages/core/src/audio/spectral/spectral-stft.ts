/** STFT plan, frame analysis and the inverse transform shared by the rectangle path and the mask path. */
import { FFT } from "../fft";

export const SPECTRAL_FFT_SIZE = 2048;
export const SPECTRAL_HOP = 512;

export interface StftPlan {
  readonly size: number;
  readonly hop: number;
  readonly fft: FFT;
  readonly window: Float32Array;
  /** Sum of the squared window over the frames that overlap any sample (constant for Hann at 75 % overlap). */
  readonly norm: number;
}

const plans = new Map<string, StftPlan>();

export function getStftPlan(size = SPECTRAL_FFT_SIZE, hop = SPECTRAL_HOP): StftPlan {
  const key = `${size}:${hop}`;
  const cached = plans.get(key);
  if (cached) return cached;
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  let norm = 0;
  for (let at = 0; at < size; at += hop) norm += window[at] * window[at];
  const plan: StftPlan = { size, hop, fft: new FFT(size), window, norm };
  plans.set(key, plan);
  return plan;
}

/** Frame indices m whose window [m*hop, m*hop + size) overlaps a signal of `length` samples. */
export function stftFrameRange(length: number, plan: StftPlan): { first: number; last: number } {
  return { first: -(plan.size / plan.hop - 1), last: Math.max(-(plan.size / plan.hop - 1), Math.floor((length - 1) / plan.hop)) };
}

export function analyseFrame(plan: StftPlan, signal: Float32Array, start: number, scratch: Float32Array): { real: Float32Array; imag: Float32Array } {
  const { size, window } = plan;
  for (let i = 0; i < size; i += 1) {
    const at = start + i;
    scratch[i] = at >= 0 && at < signal.length ? signal[at] * window[i] : 0;
  }
  return plan.fft.forward(scratch);
}

export interface StftFrames {
  /** Index of the first frame (negative: frames that start before the signal). */
  readonly first: number;
  readonly real: Float32Array[];
  readonly imag: Float32Array[];
}

/** Full STFT of a signal (every frame, full spectrum). */
export function stftForward(signal: Float32Array, plan: StftPlan = getStftPlan()): StftFrames {
  const { first, last } = stftFrameRange(signal.length, plan);
  const scratch = new Float32Array(plan.size);
  const real: Float32Array[] = [];
  const imag: Float32Array[] = [];
  for (let m = first; m <= last; m += 1) {
    const spectrum = analyseFrame(plan, signal, m * plan.hop, scratch);
    real.push(spectrum.real);
    imag.push(spectrum.imag);
  }
  return { first, real, imag };
}

/** Weighted overlap-add inverse of {@link stftForward}: perfect reconstruction when the frames are unmodified. */
export function stftInverse(frames: StftFrames, length: number, plan: StftPlan = getStftPlan()): Float32Array {
  const out = new Float32Array(length);
  const { size, hop, window, norm } = plan;
  for (let f = 0; f < frames.real.length; f += 1) {
    const start = (frames.first + f) * hop;
    const time = plan.fft.inverse(frames.real[f], frames.imag[f]);
    for (let i = 0; i < size; i += 1) {
      const at = start + i;
      if (at >= 0 && at < length) out[at] += (time[i] * window[i]) / norm;
    }
  }
  return out;
}

/** Deterministic pseudo-random phase in [0, 1) for a (bin, frame, channel): fills are noise-like but identical on every run. */
export function hashUnit(k: number, m: number, channel: number): number {
  let h = (Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(m + 4096, 0x85ebca6b) ^ Math.imul(channel + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

