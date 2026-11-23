/**
 * Weighted prediction error (WPE) dereverberation (Nakatani et al., 2010), single channel, in the STFT domain.
 *
 * In every frequency bin the late reverberation of a frame is predicted by a linear filter over the same bin of the frames at
 * least `delay` frames earlier (the delay keeps the direct sound and the early reflections out of the prediction), and the
 * prediction is subtracted. The filter is the weighted least-squares solution, the weights being the inverse of the estimated
 * power of the dereverberated speech, refined over a few iterations. No room parameter is needed: the filter is fitted to
 * the recording itself.
 *
 * Offline and block-wise: the source is cut into blocks (each fitted with its own filters, with a second of history in front so
 * the first prediction has something to predict from) and the blocks are cross-faded, so memory stays bounded for long sources.
 * Only the speech band is processed; the bins above `maxHz` pass through unchanged (their tail is short and left to the
 * spectral stage). Deterministic.
 */
import { FFT } from "../fft";
import { ReverbCancelledError } from "./reverb-params";

export interface WpeOptions {
  /** Frames between a frame and the earliest frame used to predict it. */
  readonly delay: number;
  /** Prediction filter length in frames. */
  readonly taps: number;
  readonly iterations: number;
  /** 0..1: how much of the predicted late reverb is subtracted. */
  readonly strength: number;
  /** Highest frequency (Hz) processed. */
  readonly maxHz: number;
}

export interface WpeControl {
  readonly signal?: { readonly aborted: boolean };
  readonly onProgress?: (fraction: number) => void;
  readonly yieldNow?: () => Promise<void>;
}

const BLOCK_SECONDS = 30;
const HISTORY_SECONDS = 1.5;
const FADE_SECONDS = 0.02;

/** Frame size for WPE at a rate: 43 ms (2048 at 48 kHz), hop a quarter of it. */
export function wpeFrameSize(sampleRate: number): number {
  return Math.max(512, Math.min(8192, 2 ** Math.round(Math.log2(sampleRate * 0.0427))));
}

const windows = new Map<number, Float32Array>();
const sineWindow = (size: number): Float32Array => {
  let w = windows.get(size);
  if (!w) {
    w = new Float32Array(size);
    for (let i = 0; i < size; i += 1) w[i] = Math.sin((Math.PI * (i + 0.5)) / size);
    windows.set(size, w);
  }
  return w;
};

/** Solves the complex Hermitian system A g = b in place (Gaussian elimination; A is positive definite after the ridge). */
function solveHermitian(Ar: Float64Array, Ai: Float64Array, br: Float64Array, bi: Float64Array, n: number, gr: Float64Array, gi: Float64Array): void {
  for (let c = 0; c < n; c += 1) {
    const pr = Ar[c * n + c];
    const pi = Ai[c * n + c];
    const d = pr * pr + pi * pi || 1e-300;
    for (let r = c + 1; r < n; r += 1) {
      const fr = (Ar[r * n + c] * pr + Ai[r * n + c] * pi) / d;
      const fi = (Ai[r * n + c] * pr - Ar[r * n + c] * pi) / d;
      for (let k = c; k < n; k += 1) {
        Ar[r * n + k] -= fr * Ar[c * n + k] - fi * Ai[c * n + k];
        Ai[r * n + k] -= fr * Ai[c * n + k] + fi * Ar[c * n + k];
      }
      br[r] -= fr * br[c] - fi * bi[c];
      bi[r] -= fr * bi[c] + fi * br[c];
    }
  }
  for (let r = n - 1; r >= 0; r -= 1) {
    let sr = br[r];
    let si = bi[r];
    for (let k = r + 1; k < n; k += 1) {
      sr -= Ar[r * n + k] * gr[k] - Ai[r * n + k] * gi[k];
      si -= Ar[r * n + k] * gi[k] + Ai[r * n + k] * gr[k];
    }
    const pr = Ar[r * n + r];
    const pi = Ai[r * n + r];
    const d = pr * pr + pi * pi || 1e-300;
    gr[r] = (sr * pr + si * pi) / d;
    gi[r] = (si * pr - sr * pi) / d;
  }
}

interface BlockContext {
  readonly fft: FFT;
  readonly size: number;
  readonly hop: number;
  readonly bins: number;
  readonly window: Float32Array;
  readonly options: WpeOptions;
  readonly control: WpeControl;
  readonly floor: number;
  /** Highest bin processed. */
  readonly maxBin: number;
}

/** Dereverberates `segment` (whole block incl. history); returns a buffer of the same length. */
async function processSegment(segment: Float32Array, ctx: BlockContext, progress: (fraction: number) => void): Promise<Float32Array> {
  const { fft, size, hop, bins, window, options, control } = ctx;
  const first = -3;
  const frames = Math.max(1, Math.floor((segment.length - 1) / hop) - first + 1);
  const re = new Float32Array(frames * bins);
  const im = new Float32Array(frames * bins);
  const scratch = new Float32Array(size);
  for (let f = 0; f < frames; f += 1) {
    const start = (first + f) * hop;
    for (let i = 0; i < size; i += 1) {
      const at = start + i;
      scratch[i] = at >= 0 && at < segment.length ? segment[at] * window[i] : 0;
    }
    const spectrum = fft.forward(scratch);
    re.set(spectrum.real.subarray(0, bins), f * bins);
    im.set(spectrum.imag.subarray(0, bins), f * bins);
  }
  const { delay: D, taps: K, iterations } = options;
  const lastBin = ctx.maxBin;
  const yr = new Float64Array(frames);
  const yi = new Float64Array(frames);
  const xr = new Float64Array(frames);
  const xi = new Float64Array(frames);
  const lam = new Float64Array(frames);
  const Rr = new Float64Array(K * K);
  const Ri = new Float64Array(K * K);
  const Pr = new Float64Array(K);
  const Pi = new Float64Array(K);
  const gr = new Float64Array(K);
  const gi = new Float64Array(K);
  const pr = new Float64Array(K);
  const pi = new Float64Array(K);
  const outRe = Float32Array.from(re);
  const outIm = Float32Array.from(im);
  const usable = frames > D + K + 4;
  for (let k = 1; usable && k <= lastBin; k += 1) {
    if (control.signal?.aborted) throw new ReverbCancelledError();
    if (k % 16 === 0) {
      progress(k / lastBin);
      if (control.yieldNow) await control.yieldNow();
      if (control.signal?.aborted) throw new ReverbCancelledError();
    }
    for (let t = 0; t < frames; t += 1) {
      yr[t] = re[t * bins + k];
      yi[t] = im[t * bins + k];
      xr[t] = yr[t];
      xi[t] = yi[t];
    }
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (let t = 0; t < frames; t += 1) {
        let sum = 0;
        let count = 0;
        for (let d = -1; d <= 1; d += 1) {
          const u = t + d;
          if (u >= 0 && u < frames) {
            sum += xr[u] * xr[u] + xi[u] * xi[u];
            count += 1;
          }
        }
        lam[t] = Math.max(sum / count, ctx.floor);
      }
      Rr.fill(0);
      Ri.fill(0);
      Pr.fill(0);
      Pi.fill(0);
      for (let t = D + K; t < frames; t += 1) {
        const w = 1 / lam[t];
        const ytr = yr[t];
        const yti = yi[t];
        for (let a = 0; a < K; a += 1) {
          const ar = yr[t - D - a];
          const ai = yi[t - D - a];
          Pr[a] += w * (ar * ytr + ai * yti);
          Pi[a] += w * (ai * ytr - ar * yti);
          const row = a * K;
          for (let b = 0; b <= a; b += 1) {
            const br = yr[t - D - b];
            const bi = yi[t - D - b];
            Rr[row + b] += w * (ar * br + ai * bi);
            Ri[row + b] += w * (ai * br - ar * bi);
          }
        }
      }
      let trace = 0;
      for (let a = 0; a < K; a += 1) trace += Rr[a * K + a];
      for (let a = 0; a < K; a += 1) Rr[a * K + a] += (1e-5 * trace) / K + 1e-30;
      for (let a = 0; a < K; a += 1) {
        for (let b = a + 1; b < K; b += 1) {
          Rr[a * K + b] = Rr[b * K + a];
          Ri[a * K + b] = -Ri[b * K + a];
        }
      }
      pr.set(Pr);
      pi.set(Pi);
      solveHermitian(Rr, Ri, pr, pi, K, gr, gi);
      for (let t = 0; t < frames; t += 1) {
        let sr = 0;
        let si = 0;
        if (t - D - K + 1 >= 0) {
          for (let a = 0; a < K; a += 1) {
            const ar = yr[t - D - a];
            const ai = yi[t - D - a];
            sr += gr[a] * ar + gi[a] * ai;
            si += gr[a] * ai - gi[a] * ar;
          }
        }
        xr[t] = yr[t] - sr;
        xi[t] = yi[t] - si;
      }
    }
    const s = options.strength;
    for (let t = 0; t < frames; t += 1) {
      outRe[t * bins + k] = yr[t] + (xr[t] - yr[t]) * s;
      outIm[t * bins + k] = yi[t] + (xi[t] - yi[t]) * s;
    }
  }
  progress(1);
  const out = new Float32Array(segment.length);
  const fr = new Float32Array(size);
  const fi = new Float32Array(size);
  for (let f = 0; f < frames; f += 1) {
    for (let k = 0; k < bins; k += 1) {
      fr[k] = outRe[f * bins + k];
      fi[k] = outIm[f * bins + k];
      if (k > 0 && k < size / 2) {
        fr[size - k] = fr[k];
        fi[size - k] = -fi[k];
      }
    }
    fi[0] = 0;
    fi[size / 2] = 0;
    const time = fft.inverse(fr, fi);
    const start = (first + f) * hop;
    for (let i = 0; i < size; i += 1) {
      const at = start + i;
      if (at >= 0 && at < out.length) out[at] += time[i] * window[i] * 0.5;
    }
  }
  return out;
}

/** Late-reverb removal of one channel by WPE. */
export async function wpeChannel(x: Float32Array, sampleRate: number, options: WpeOptions, control: WpeControl = {}): Promise<Float32Array> {
  const size = wpeFrameSize(sampleRate);
  const hop = size / 4;
  const bins = size / 2 + 1;
  const fft = new FFT(size);
  let meanPower = 0;
  for (let i = 0; i < x.length; i += 1) meanPower += x[i] * x[i];
  meanPower /= Math.max(1, x.length);
  const maxBin = Math.min(bins - 1, Math.floor((Math.min(options.maxHz, sampleRate * 0.5) * size) / sampleRate));
  const ctx: BlockContext = {
    fft,
    size,
    hop,
    bins,
    window: sineWindow(size),
    // Relative power floor so a quieter decode of the same source gives the same result.
    floor: meanPower * size * 1e-8 + 1e-30,
    options,
    maxBin,
    control,
  };
  if (options.strength <= 0 || x.length === 0) return Float32Array.from(x);
  const block = Math.max(hop * 8, Math.round((BLOCK_SECONDS * sampleRate) / hop) * hop);
  const history = Math.round((HISTORY_SECONDS * sampleRate) / hop) * hop;
  const fade = Math.max(1, Math.round(FADE_SECONDS * sampleRate));
  const out = new Float32Array(x.length);
  const blocks = Math.max(1, Math.ceil(x.length / block));
  for (let b = 0; b < blocks; b += 1) {
    if (control.signal?.aborted) throw new ReverbCancelledError();
    const start = b * block;
    const end = Math.min(x.length, start + block);
    const tail = b < blocks - 1 ? Math.min(x.length, end + fade) : end;
    const from = Math.max(0, start - history);
    const segment = x.subarray(from, tail);
    const processed = await processSegment(segment, ctx, (fraction) => control.onProgress?.((b + fraction) / blocks));
    for (let i = start; i < tail; i += 1) {
      let weight = 1;
      if (b > 0 && i < start + fade) weight = (i - start + 0.5) / fade;
      if (b < blocks - 1 && i >= end) weight = 1 - (i - end + 0.5) / fade;
      out[i] += processed[i - from] * weight;
    }
  }
  control.onProgress?.(1);
  return out;
}
