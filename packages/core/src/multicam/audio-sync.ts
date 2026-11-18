import { FFT } from "../audio/fft";

/**
 * Audio-waveform sync for multi-camera angles (Premiere's "Audio" sync).
 *
 * Both angles are decimated to `analysisRate`, then cross-correlated through
 * the FFT with phase-transform weighting (GCC-PHAT), which stays sharp when
 * the cameras' microphones colour the same sound differently. The peak is
 * refined with a parabola, so the result is sub-sample accurate.
 *
 * Sign convention (shared with `MulticamAngle.offset`): the result is the
 * shared-timeline time at which the target's media time 0 plays, when the
 * reference's media time 0 plays at shared time 0. A sound at media time `a`
 * in the reference and `b` in the target gives `offsetSeconds = a - b`.
 */
export interface AudioOffsetOptions {
  /** Rate both signals are decimated to before correlating (default 4000 Hz: 0.25 ms steps). */
  analysisRate?: number;
  /** Largest |offset| searched (default 120 s). */
  maxOffsetSeconds?: number;
  /** Only the first this-many seconds of each signal are analysed (default 180 s). */
  windowSeconds?: number;
}

export interface AudioOffsetResult {
  readonly offsetSeconds: number;
  /** 0..1 peak sharpness against the rest of the correlation. */
  readonly confidence: number;
}

export const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

/** Box-average decimation (anti-aliased) of the first `seconds` of `samples` to `rate`. */
export function decimateForSync(samples: Float32Array, sampleRate: number, rate: number, seconds: number): Float32Array {
  const available = Math.min(samples.length, Math.floor(seconds * sampleRate));
  const outLength = Math.floor((available / sampleRate) * rate);
  const out = new Float32Array(outLength);
  const ratio = sampleRate / rate;
  for (let i = 0; i < outLength; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.min(available, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j] ?? 0;
    out[i] = sum / (to - from);
  }
  let mean = 0;
  for (let i = 0; i < outLength; i++) mean += out[i];
  mean = outLength ? mean / outLength : 0;
  for (let i = 0; i < outLength; i++) out[i] -= mean;
  return out;
}

export function findAudioOffset(
  reference: Float32Array,
  referenceRate: number,
  target: Float32Array,
  targetRate: number,
  options: AudioOffsetOptions = {},
): AudioOffsetResult {
  const rate = options.analysisRate ?? 4000;
  const windowSeconds = options.windowSeconds ?? 180;
  const r = decimateForSync(reference, referenceRate, rate, windowSeconds);
  const t = decimateForSync(target, targetRate, rate, windowSeconds);
  return correlateDecimated(r, t, rate, Math.round((options.maxOffsetSeconds ?? 120) * rate));
}

/**
 * GCC-PHAT of two signals already decimated to `rate` (mean removed).
 * `maxLag` is in samples of `rate`.
 */
export function correlateDecimated(r: Float32Array, t: Float32Array, rate: number, maxLag: number): AudioOffsetResult {
  if (r.length < rate / 10 || t.length < rate / 10) return { offsetSeconds: 0, confidence: 0 };

  const size = nextPow2(r.length + t.length);
  const fft = new FFT(size);
  const rs = fft.forward(r.length === size ? r : Float32Array.from({ length: size }, (_, i) => r[i] ?? 0));
  const ts = fft.forward(t.length === size ? t : Float32Array.from({ length: size }, (_, i) => t[i] ?? 0));
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  let peakMag = 0;
  const mags = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    // S = T * conj(R); the inverse transform is c[d] = sum_n t[n + d] r[n].
    const re = ts.real[i] * rs.real[i] + ts.imag[i] * rs.imag[i];
    const im = ts.imag[i] * rs.real[i] - ts.real[i] * rs.imag[i];
    const mag = Math.hypot(re, im);
    mags[i] = mag;
    if (mag > peakMag) peakMag = mag;
    real[i] = re;
    imag[i] = im;
  }
  // PHAT weighting, regularised so silent bins do not become noise.
  const floor = peakMag * 1e-4 + 1e-30;
  for (let i = 0; i < size; i++) {
    const w = 1 / (mags[i] + floor);
    real[i] *= w;
    imag[i] *= w;
  }
  const c = fft.inverse(real, imag);

  const at = (d: number): number => c[((d % size) + size) % size];
  let bestD = 0;
  let best = -Infinity;
  const lo = -Math.min(maxLag, t.length - 1);
  const hi = Math.min(maxLag, r.length - 1);
  for (let d = lo; d <= hi; d++) {
    const v = at(d);
    if (v > best) {
      best = v;
      bestD = d;
    }
  }
  // Parabolic refinement around the peak.
  const y0 = at(bestD - 1);
  const y1 = at(bestD);
  const y2 = at(bestD + 1);
  const denom = y0 - 2 * y1 + y2;
  const delta = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;

  // Peak-to-sidelobe ratio outside a small guard band around the peak.
  const guard = Math.round(rate * 0.01);
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  const stride = Math.max(1, Math.floor((hi - lo) / 20000));
  for (let d = lo; d <= hi; d += stride) {
    if (Math.abs(d - bestD) <= guard) continue;
    const v = at(d);
    sum += v;
    sumSq += v * v;
    count++;
  }
  const mean = count ? sum / count : 0;
  const std = count ? Math.sqrt(Math.max(0, sumSq / count - mean * mean)) : 0;
  const psr = std > 0 ? (best - mean) / std : 0;
  const confidence = Math.max(0, Math.min(1, psr / 14));
  return { offsetSeconds: -(bestD + delta) / rate, confidence };
}
