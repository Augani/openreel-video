/** Synthetic cases and measurements for comparing spectral remove and heal against the clean signal underneath. */
import { applySpectralRegionsToChannel } from "./spectral-dsp";
import { SR, speechLike, sum, tubePolygon, whistle, whistlePath } from "./spectral-fixtures";
import { rasterizeRegionMask } from "./spectral-mask";
import { sanitizeSpectralRegions, type SpectralRegion } from "./spectral-regions";
import { getStftPlan, stftForward } from "./spectral-stft";

const base = { id: "a", enabled: true, gainDb: -120, startTime: 0, endTime: 0, lowHz: 0, highHz: 0 } as const;

const lcg = (seed: number) => {
  let s = seed >>> 0;
  return (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const gauss = (rng: () => number): number => Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());

export function whiteNoise(seconds: number, rms: number, seed = 5): Float32Array {
  const rng = lcg(seed);
  return Float32Array.from({ length: Math.round(seconds * SR) }, () => rms * gauss(rng));
}

/** Pink noise (1/f power) by the Voss-McCartney / Paul Kellet filter. */
export function pinkNoise(seconds: number, rms: number, seed = 7): Float32Array {
  const rng = lcg(seed);
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    const w = gauss(rng);
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    out[i] = v;
    energy += v * v;
  }
  const g = rms / Math.sqrt(energy / n);
  for (let i = 0; i < n; i += 1) out[i] *= g;
  return out;
}

export const tone = (length: number, hz: number, amp: number, t0: number, t1: number): Float32Array => {
  const out = new Float32Array(length);
  for (let i = Math.floor(t0 * SR); i < Math.min(length, Math.floor(t1 * SR)); i += 1) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
};

/** Music-like: a sustained chord of harmonic notes with slight vibrato, soft attack and a trace of noise. */
export function musicLike(seconds: number, vibrato = 0.003): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const notes = [220, 277.18, 329.63, 440];
  const rng = lcg(3);
  notes.forEach((f0, ni) => {
    let phase = 0.7 * ni;
    for (let i = 0; i < n; i += 1) {
      const t = i / SR;
      phase += (2 * Math.PI * f0 * (1 + vibrato * Math.sin(2 * Math.PI * (4.5 + 0.3 * ni) * t))) / SR;
      let v = 0;
      for (let h = 1; h <= 12; h += 1) v += Math.sin(h * phase + h * ni) / (h * 1.3);
      out[i] += 0.06 * v * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.7 * t + ni));
    }
  });
  for (let i = 0; i < n; i += 1) out[i] += 0.002 * (rng() - 0.5);
  return out;
}

/** A cough-like burst: band-limited noise with a fast attack and a decay. */
export function burst(length: number, t0: number, t1: number, amp: number): Float32Array {
  const rng = lcg(99);
  const out = new Float32Array(length);
  let lp = 0, lp2 = 0;
  for (let i = Math.floor(t0 * SR); i < Math.min(length, Math.floor(t1 * SR)); i += 1) {
    const u = (i / SR - t0) / (t1 - t0);
    lp += 0.35 * (gauss(rng) - lp);
    lp2 += 0.03 * (lp - lp2);
    out[i] = amp * (lp - lp2) * Math.min(1, u * 20) * Math.exp(-3.5 * u);
  }
  return out;
}

export interface BenchCase {
  readonly name: string;
  readonly clean: Float32Array;
  readonly noisy: Float32Array;
  readonly region: (mode: "remove" | "heal") => SpectralRegion;
  /** What a user reaches for if they have no heal: the same mask with the interpolated remove (rectangles keep their original code path). */
  readonly kind: "rect" | "lasso";
}

const rect = (startTime: number, endTime: number, lowHz: number, highHz: number) => (mode: "remove" | "heal"): SpectralRegion =>
  sanitizeSpectralRegions([{ ...base, mode, startTime, endTime, lowHz, highHz }])[0];

export function benchCases(): BenchCase[] {
  const out: BenchCase[] = [];
  {
    const clean = whiteNoise(1.6, 0.05);
    const noisy = sum(clean, tone(clean.length, 1000, 0.1, 0.4, 1.2));
    out.push({ name: "a1 tone 1 kHz over white noise", clean, noisy, kind: "rect", region: rect(0.37, 1.23, 850, 1150) });
  }
  {
    const clean = pinkNoise(1.6, 0.05);
    const noisy = sum(clean, tone(clean.length, 1000, 0.1, 0.4, 1.2));
    out.push({ name: "a2 tone 1 kHz over pink noise", clean, noisy, kind: "rect", region: rect(0.37, 1.23, 850, 1150) });
  }
  {
    const clean = speechLike(1.6);
    const w = whistle(clean.length, 0.3, 1.3, 1500, 3500, 0.06);
    const polygon = tubePolygon(whistlePath(0.3, 1.3, 1500, 3500, 40), 0.05);
    out.push({ name: "b1 whistle 1.5-3.5k over speech-like", clean, noisy: sum(clean, w), kind: "lasso", region: (mode) => sanitizeSpectralRegions([{ ...base, mode, shape: "lasso", points: polygon }])[0] });
  }
  {
    const clean = speechLike(1.6);
    const w = whistle(clean.length, 0.3, 1.3, 300, 1600, 0.12);
    const polygon = tubePolygon(whistlePath(0.3, 1.3, 300, 1600, 40), 0.05);
    out.push({ name: "b2 whistle 0.3-1.6k over speech-like", clean, noisy: sum(clean, w), kind: "lasso", region: (mode) => sanitizeSpectralRegions([{ ...base, mode, shape: "lasso", points: polygon }])[0] });
  }
  {
    const clean = musicLike(1.6);
    const noisy = sum(clean, burst(clean.length, 0.6, 0.7, 0.4));
    out.push({ name: "c1 cough burst over chord", clean, noisy, kind: "rect", region: rect(0.54, 0.76, 150, 6000) });
  }
  {
    const clean = musicLike(1.6);
    const noisy = sum(clean, burst(clean.length, 0.6, 0.62, 0.4));
    out.push({ name: "c2 short click over chord (hi band)", clean, noisy, kind: "rect", region: rect(0.54, 0.68, 2000, 9000) });
  }
  {
    const clean = musicLike(1.6, 0);
    const noisy = sum(clean, burst(clean.length, 0.6, 0.7, 0.4));
    out.push({ name: "c3 cough burst over steady chord", clean, noisy, kind: "rect", region: rect(0.54, 0.76, 150, 6000) });
  }
  {
    const clean = musicLike(1.6, 0);
    const noisy = sum(clean, burst(clean.length, 0.6, 0.62, 0.4));
    out.push({ name: "c4 short click over steady chord", clean, noisy, kind: "rect", region: rect(0.54, 0.68, 2000, 9000) });
  }
  {
    const clean = whiteNoise(1.6, 0.05, 21);
    const noisy = sum(clean, burst(clean.length, 0.6, 0.7, 0.4));
    out.push({ name: "d1 burst over white noise", clean, noisy, kind: "rect", region: rect(0.54, 0.76, 150, 6000) });
  }
  {
    const clean = pinkNoise(1.6, 0.05, 23);
    const noisy = sum(clean, burst(clean.length, 0.6, 0.7, 0.4));
    out.push({ name: "d2 burst over pink noise", clean, noisy, kind: "rect", region: rect(0.54, 0.76, 150, 6000) });
  }
  return out;
}

export interface FillScore {
  /** Complex error vs the clean signal over the masked cells, dB re the clean energy there (lower is better; 0 dB = as bad as a hole, +3 dB = uncorrelated equal-level fill). */
  readonly errDb: number;
  /** Mean power of the filled cells vs the clean cells under them, dB (0 = level preserved, large negative = hole). */
  readonly levelDb: number;
  /** Std-dev of log-magnitude (dB) of the filled cells minus that of the clean cells: 0 = texture preserved, very negative = smoothed / flat fill. */
  readonly textureDb: number;
  /** Share of masked cells more than 12 dB below the clean cell mean (holes). */
  readonly holes: number;
  /** Magnitude-domain error (log-spectral distance on a smoothed grid): rms dB difference of band-averaged power between output and clean. */
  readonly smoothLsdDb: number;
  /** Correlation of the filled cells with the clean ones (real part of the complex inner product / norms), 0..1: how much of the lost waveform the fill actually predicts. */
  readonly corr: number;
  /** Complex error over the cells where the clean signal is strong (within 30 dB of its loudest masked cell), dB re the clean energy there: the part a tonal model can predict. */
  readonly strongErrDb: number;
}

const dB = (a: number, b: number): number => 10 * Math.log10(Math.max(1e-30, a) / Math.max(1e-30, b));

export function scoreFill(out: Float32Array, clean: Float32Array, region: SpectralRegion): FillScore {
  const plan = getStftPlan();
  const so = stftForward(out, plan);
  const sc = stftForward(clean, plan);
  const mask = rasterizeRegionMask(region, { sampleRate: SR, size: plan.size, hop: plan.hop, firstFrame: sc.first, lastFrame: sc.first + sc.real.length - 1 });
  if (!mask) throw new Error("no mask");
  let err = 0, cp = 0, op = 0, n = 0, holes = 0, inner = 0, strongErr = 0, strongClean = 0, loudest = 0;
  const lo: number[] = [];
  const lc: number[] = [];
  let meanC = 0;
  for (let m = mask.mFirst; m <= mask.mLast; m += 1) {
    const f = m - sc.first;
    for (let k = mask.kLo; k <= mask.kHi; k += 1) {
      if (mask.weights[(m - mask.mFirst) * mask.bins + (k - mask.kLo)] < 0.98) continue;
      const pc = sc.real[f][k] ** 2 + sc.imag[f][k] ** 2;
      meanC += pc;
      loudest = Math.max(loudest, pc);
      n += 1;
    }
  }
  meanC /= Math.max(1, n);
  // band-averaged (3 frames x 8 bins) power for a texture-free spectral shape comparison
  const bandO = new Map<string, [number, number, number]>();
  for (let m = mask.mFirst; m <= mask.mLast; m += 1) {
    const f = m - sc.first;
    for (let k = mask.kLo; k <= mask.kHi; k += 1) {
      if (mask.weights[(m - mask.mFirst) * mask.bins + (k - mask.kLo)] < 0.98) continue;
      const pc = sc.real[f][k] ** 2 + sc.imag[f][k] ** 2;
      const po = so.real[f][k] ** 2 + so.imag[f][k] ** 2;
      const dr = so.real[f][k] - sc.real[f][k];
      const di = so.imag[f][k] - sc.imag[f][k];
      err += dr * dr + di * di;
      if (pc >= loudest * 1e-3) {
        strongErr += dr * dr + di * di;
        strongClean += pc;
      }
      inner += so.real[f][k] * sc.real[f][k] + so.imag[f][k] * sc.imag[f][k];
      cp += pc;
      op += po;
      if (po < meanC * 0.063) holes += 1;
      lo.push(10 * Math.log10(po + 1e-20));
      lc.push(10 * Math.log10(pc + 1e-20));
      const key = `${Math.floor(m / 3)}:${Math.floor(k / 8)}`;
      const b = bandO.get(key) ?? [0, 0, 0];
      b[0] += po;
      b[1] += pc;
      b[2] += 1;
      bandO.set(key, b);
    }
  }
  const std = (v: number[]): number => {
    const mu = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / v.length);
  };
  let lsd = 0;
  for (const [, [o, c, cnt]] of bandO) lsd += (dB(o / cnt, c / cnt)) ** 2;
  return { errDb: dB(err, cp), levelDb: dB(op, cp), textureDb: std(lo) - std(lc), holes: holes / n, smoothLsdDb: Math.sqrt(lsd / bandO.size), corr: inner / Math.sqrt(Math.max(1e-30, cp * op)), strongErrDb: dB(strongErr, strongClean) };
}

/** Deterministic perturbation of `amount` per sample (uniform, +-amount). */
export function perturb(x: Float32Array, amount: number, seed = 1): Float32Array {
  const rng = lcg(seed);
  return x.map((v) => v + amount * (2 * rng() - 1));
}

/** Output change per input change, dB, for a perturbation of `amount`: 0 dB is a perfectly conditioned edit. */
export function amplificationDb(x: Float32Array, region: SpectralRegion, amount = 3e-8): number {
  const y = perturb(x, amount);
  const o0 = applySpectralRegionsToChannel(x, SR, [region]);
  const o1 = applySpectralRegionsToChannel(y, SR, [region]);
  let dOut = 0, dIn = 0;
  for (let i = 0; i < x.length; i += 1) {
    dOut += (o1[i] - o0[i]) ** 2;
    dIn += (y[i] - x[i]) ** 2;
  }
  return dB(dOut, dIn) / 2;
}
