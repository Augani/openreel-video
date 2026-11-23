/** Synthetic signals and measurements shared by the spectral heal / mask tests. */
import { getStftPlan, stftForward } from "./spectral-stft";
import { rasterizeRegionMask } from "./spectral-mask";
import type { SpectralPoint, SpectralRegion } from "./spectral-regions";

export const SR = 48000;

/** Speech-like harmonic signal: a gliding pitch with a formant envelope, syllable-rate amplitude modulation and a little noise. */
export function speechLike(seconds: number, seed = 11): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let phase = 0;
  let rng = seed;
  const formants: Array<[number, number, number]> = [[700, 1, 160], [1250, 0.6, 200], [2600, 0.4, 300], [3400, 0.25, 350]];
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    const f0 = 110 + 50 * (0.5 - 0.5 * Math.cos((Math.PI * t) / seconds)) + 6 * Math.sin(2 * Math.PI * 5 * t);
    phase += (2 * Math.PI * f0) / SR;
    const am = 0.65 + 0.35 * Math.sin(2 * Math.PI * 3.5 * t - 0.8);
    let v = 0;
    for (let h = 1; h * f0 < 5000; h += 1) {
      const f = h * f0;
      let env = 0.03;
      for (const [fc, g, bw] of formants) env += g * Math.exp(-((f - fc) * (f - fc)) / (2 * bw * bw));
      v += (env / Math.pow(h, 0.3)) * Math.sin(h * phase + h);
    }
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    out[i] = 0.12 * am * v + 0.002 * (rng / 4294967296 - 0.5);
  }
  return out;
}

/** A whistle sweeping from `f0` to `f1` Hz between `t0` and `t1` seconds. */
export function whistle(length: number, t0: number, t1: number, f0: number, f1: number, amplitude: number): Float32Array {
  const out = new Float32Array(length);
  const a = Math.floor(t0 * SR);
  const b = Math.min(length, Math.floor(t1 * SR));
  let phase = 0;
  for (let i = a; i < b; i += 1) {
    const u = (i - a) / (b - a);
    const f = f0 * Math.pow(f1 / f0, u);
    phase += (2 * Math.PI * f) / SR;
    const fade = Math.min(1, u * 40, (1 - u) * 40);
    out[i] = amplitude * fade * Math.sin(phase);
  }
  return out;
}

export const sum = (a: Float32Array, b: Float32Array): Float32Array => a.map((v, i) => v + b[i]);

/** The whistle's centre path as lasso-polygon / brush-stroke points. */
export function whistlePath(t0: number, t1: number, f0: number, f1: number, steps: number): SpectralPoint[] {
  return Array.from({ length: steps + 1 }, (_, s) => {
    const u = s / steps;
    return { t: t0 + (t1 - t0) * u, hz: f0 * Math.pow(f1 / f0, u) };
  });
}

/** A polygon hugging a path: the path shifted up and down by `octaves`, closed. */
export function tubePolygon(path: readonly SpectralPoint[], octaves: number, minHalfWidthHz = 110): SpectralPoint[] {
  const up = path.map((p) => ({ t: p.t, hz: p.hz + Math.max(p.hz * (Math.pow(2, octaves) - 1), minHalfWidthHz) }));
  const down = path.map((p) => ({ t: p.t, hz: Math.max(1, p.hz - Math.max(p.hz * (1 - Math.pow(2, -octaves)), minHalfWidthHz)) })).reverse();
  return [...up, ...down];
}

export interface Measure {
  /** Error inside the mask relative to the energy of what was removed, dB. 0 dB: as large as the whistle; more negative is better. */
  readonly maskErrorDb: number;
  /** Remaining energy of the whistle's own cells inside the mask relative to the original whistle, dB. */
  readonly whistleLeftDb: number;
  /** Signal-to-error ratio over STFT cells the mask never touches, dB. */
  readonly snrOutsideDb: number;
  /** Magnitude-only error inside the mask (phase ignored), dB re the whistle. */
  readonly magErrorDb: number;
  /** Waveform signal-to-error ratio of the whole signal against the clean one, dB (higher is better). */
  readonly waveSnrDb: number;
  /** Complex error inside the mask over the cells where the clean signal is strong (within 30 dB of its loudest masked cell), dB re the clean energy there. */
  readonly strongCellErrorDb: number;
}

/** Compares `out` with `clean` (what the edit should recover) on the STFT grid, relative to `whistleOnly`, inside and outside `mask`. */
export function measure(out: Float32Array, clean: Float32Array, whistleOnly: Float32Array, regions: readonly SpectralRegion[]): Measure {
  const plan = getStftPlan();
  const so = stftForward(out, plan);
  const sc = stftForward(clean, plan);
  const sw = stftForward(whistleOnly, plan);
  const range = { first: sc.first, last: sc.first + sc.real.length - 1 };
  const masks = regions.map((region) => rasterizeRegionMask(region, { sampleRate: SR, size: plan.size, hop: plan.hop, firstFrame: range.first, lastFrame: range.last }));
  const weightAt = (m: number, k: number): number => {
    let best = 0;
    for (const mask of masks) {
      if (!mask || m < mask.mFirst || m > mask.mLast || k < mask.kLo || k > mask.kHi) continue;
      best = Math.max(best, mask.weights[(m - mask.mFirst) * mask.bins + (k - mask.kLo)]);
    }
    return best;
  };
  let errIn = 0;
  let whistleIn = 0;
  let outWhistle = 0;
  let cleanOut = 0;
  let errOut = 0;
  let magErr = 0;
  let strongErr = 0;
  let strongClean = 0;
  let loudest = 0;
  const half = plan.size / 2;
  for (let f = 0; f < sc.real.length; f += 1) {
    const m = sc.first + f;
    for (let k = 0; k <= half; k += 1) if (weightAt(m, k) >= 0.5) loudest = Math.max(loudest, sc.real[f][k] ** 2 + sc.imag[f][k] ** 2);
  }
  for (let f = 0; f < sc.real.length; f += 1) {
    const m = sc.first + f;
    for (let k = 0; k <= half; k += 1) {
      const w = weightAt(m, k);
      const dr = so.real[f][k] - sc.real[f][k];
      const di = so.imag[f][k] - sc.imag[f][k];
      const e = dr * dr + di * di;
      if (w >= 0.5) {
        errIn += e;
        const dm = Math.hypot(so.real[f][k], so.imag[f][k]) - Math.hypot(sc.real[f][k], sc.imag[f][k]);
        magErr += dm * dm;
        const ce = sc.real[f][k] ** 2 + sc.imag[f][k] ** 2;
        if (ce >= loudest * 1e-3) {
          strongErr += e;
          strongClean += ce;
        }
        whistleIn += sw.real[f][k] ** 2 + sw.imag[f][k] ** 2;
        // Energy of the output that is NOT explained by the clean signal and lies along the whistle's cells.
        const wr = so.real[f][k] - sc.real[f][k];
        const wi = so.imag[f][k] - sc.imag[f][k];
        const proj = (wr * sw.real[f][k] + wi * sw.imag[f][k]) / Math.max(1e-30, Math.hypot(sw.real[f][k], sw.imag[f][k]));
        outWhistle += proj * proj;
      } else if (w === 0) {
        errOut += e;
        cleanOut += sc.real[f][k] ** 2 + sc.imag[f][k] ** 2;
      }
    }
  }
  const dB = (num: number, den: number) => 10 * Math.log10(Math.max(1e-30, num) / Math.max(1e-30, den));
  let eW = 0;
  let cW = 0;
  for (let i = 0; i < out.length; i += 1) {
    eW += (out[i] - clean[i]) ** 2;
    cW += clean[i] ** 2;
  }
  return { waveSnrDb: dB(cW, eW), maskErrorDb: dB(errIn, whistleIn), whistleLeftDb: dB(outWhistle, whistleIn), snrOutsideDb: dB(cleanOut, errOut), magErrorDb: dB(magErr, whistleIn), strongCellErrorDb: dB(strongErr, strongClean) };
}

/** A harmonic tone: `partials` sines at multiples of an f0 given as a function of time, amplitude 1/h^rolloff, phases integrated (so a vibrato or glide is exact). */
export function harmonicTone(seconds: number, f0At: (t: number) => number, partials: number, amplitude: number, options: { rolloff?: number; start?: number; end?: number; sampleRate?: number } = {}): Float32Array {
  const sr = options.sampleRate ?? SR;
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  const a = Math.floor((options.start ?? 0) * sr);
  const b = Math.min(n, Math.floor((options.end ?? seconds) * sr));
  const rolloff = options.rolloff ?? 0.7;
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    phase += (2 * Math.PI * f0At(i / sr)) / sr;
    if (i < a || i >= b) continue;
    const fade = Math.min(1, (i - a) / 480, (b - i) / 480);
    let v = 0;
    for (let h = 1; h <= partials; h += 1) v += Math.sin(h * phase + 0.3 * h) / Math.pow(h, rolloff);
    out[i] = amplitude * fade * v;
  }
  return out;
}

/** Deterministic white noise. */
export function whiteNoise(length: number, amplitude: number, seed = 5): Float32Array {
  const out = new Float32Array(length);
  let rng = seed;
  for (let i = 0; i < length; i += 1) {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    out[i] = amplitude * 2 * (rng / 4294967296 - 0.5);
  }
  return out;
}

/** Share of a signal's STFT energy (cells weighted by the region's soft mask) that a region covers: 1 means the region holds all of it. */
export function maskEnergyShare(signal: Float32Array, region: SpectralRegion, sampleRate = SR): number {
  const plan = getStftPlan();
  const st = stftForward(signal, plan);
  const mask = rasterizeRegionMask(region, { sampleRate, size: plan.size, hop: plan.hop, firstFrame: st.first, lastFrame: st.first + st.real.length - 1 });
  let inside = 0;
  let total = 0;
  for (let f = 0; f < st.real.length; f += 1) {
    for (let k = 0; k <= plan.size / 2; k += 1) {
      const e = st.real[f][k] ** 2 + st.imag[f][k] ** 2;
      total += e;
      if (mask && st.first + f >= mask.mFirst && st.first + f <= mask.mLast && k >= mask.kLo && k <= mask.kHi) inside += e * mask.weights[(st.first + f - mask.mFirst) * mask.bins + (k - mask.kLo)];
    }
  }
  return total > 0 ? inside / total : 0;
}

export const energy = (a: Float32Array): number => a.reduce((s, v) => s + v * v, 0);
export const ratioDb = (num: number, den: number): number => 10 * Math.log10(Math.max(1e-30, num) / Math.max(1e-30, den));

/** Error in cents of every track point against the true f0 function. */
export function trackErrorsCents(points: readonly { t: number; hz: number }[], truth: (t: number) => number): number[] {
  return points.map((p) => Math.abs(1200 * Math.log2(p.hz / truth(p.t)))).sort((a, b) => a - b);
}
