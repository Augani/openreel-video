/**
 * Reduce Reverb: blind late-reverberation suppression for dialogue, in two stages (see `reduceReverbChannel`).
 *
 * Stage 1 is weighted prediction error dereverberation (`reverb-wpe.ts`): no room parameter, the largest SI-SDR gain, but it leaves
 * the pauses fairly reverberant. Stage 2 is the statistical late-reverb model after Lebart et al. (2001) and Habets (2007): the
 * reverberant tail of a room decays exponentially, so the late reverb power in every STFT bin can be predicted from the power one
 * early/late boundary (50 ms) earlier, attenuated by the room's decay. Three things make it more than a spectral subtraction:
 *
 *  1. The decay rate is not a setting. RT60 is estimated blind from the signal itself: the energy envelope of the speech band is
 *     searched for free decays (after word and syllable ends), each is fitted with a line in dB, and the slow end of the
 *     distribution is taken, because speech offsets can only decay faster than the room, never slower.
 *  2. The tail is a recursion, L(m) = rho L(m-1) + c P(m - Nd), with the recursion constant derived from the exponential energy
 *     decay rather than a single lagged copy, and fed with what is left after suppression (the estimate of the direct and early
 *     sound) so the tail of the tail is not counted twice.
 *  3. The gain is a decision-directed Wiener gain on the direct-to-late-reverb ratio with a floor, smoothed over frequency and
 *     time (a-priori SNR smoothing is what keeps spectral-subtraction "musical noise" away).
 *
 * Both stages are offline, streaming or block-wise (memory is a few frames of spectra, not the whole STFT) and deterministic, so
 * the preview and the export that read the cached result get identical samples. Early reflections are not touched.
 */
import { FFT } from "../fft";
import { limitPeaks, peakOfChannels } from "./reverb-limiter";
import { REDUCE_REVERB_MODEL_ID, ReverbCancelledError, sanitizeReverbPercent, type ReduceReverbParams } from "./reverb-params";
import { wpeChannel, wpeFrameSize } from "./reverb-wpe";

/** Early/late boundary: the part of the room response before this is kept (it adds body; only the late tail smears speech). */
const EARLY_SECONDS = 0.05;
const FALLBACK_RT60 = 0.45;
const MIN_RT60 = 0.12;
const MAX_RT60 = 3;

export interface Rt60Estimate {
  /** Seconds. */
  readonly rt60: number;
  /** 0..1: how much evidence there was (number of clean decays). 0 means the fallback was used. */
  readonly confidence: number;
  readonly decays: number;
}

export interface ReduceReverbOptions {
  readonly signal?: { readonly aborted: boolean };
  readonly onProgress?: (fraction: number) => void;
  /** Called between frame batches; lets a worker or the main thread yield so cancel messages are seen. */
  readonly yieldNow?: () => Promise<void>;
  /** Overrides the blind RT60 (seconds), for measurement. */
  readonly rt60?: number;
}

export { REDUCE_REVERB_MODEL_ID, ReverbCancelledError, sanitizeReverbPercent };
export type { ReduceReverbParams };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface FramePlan {
  readonly size: number;
  readonly hop: number;
  readonly window: Float32Array;
  readonly fft: FFT;
  readonly bins: number;
}

const plans = new Map<number, FramePlan>();

/** 21 to 43 ms analysis frames at 75 % overlap, whatever the rate (power of two so the shared FFT applies). */
function planFor(sampleRate: number): FramePlan {
  const size = Math.max(256, Math.min(4096, 2 ** Math.round(Math.log2(sampleRate * 0.0213))));
  const cached = plans.get(size);
  if (cached) return cached;
  const window = new Float32Array(size);
  // Sine window used for analysis and synthesis: sin^2 at 75 % overlap sums to 2.
  for (let i = 0; i < size; i += 1) window[i] = Math.sin((Math.PI * (i + 0.5)) / size);
  const plan: FramePlan = { size, hop: size / 4, window, fft: new FFT(size), bins: size / 2 + 1 };
  plans.set(size, plan);
  return plan;
}

function frameCount(length: number, plan: FramePlan): { first: number; count: number } {
  const first = -3;
  const last = Math.max(first, Math.floor((length - 1) / plan.hop));
  return { first, count: last - first + 1 };
}

function analyse(plan: FramePlan, x: Float32Array, start: number, scratch: Float32Array): { real: Float32Array; imag: Float32Array } {
  for (let i = 0; i < plan.size; i += 1) {
    const at = start + i;
    scratch[i] = at >= 0 && at < x.length ? x[at] * plan.window[i] : 0;
  }
  return plan.fft.forward(scratch);
}

/** Speech-band energy (dB) per frame: the envelope the decay search runs on. */
export function bandEnergyEnvelope(x: Float32Array, sampleRate: number): { env: Float64Array; frameSeconds: number } {
  const plan = planFor(sampleRate);
  const { first, count } = frameCount(x.length, plan);
  const lo = Math.max(1, Math.round((250 * plan.size) / sampleRate));
  const hi = Math.min(plan.bins - 1, Math.round((Math.min(4500, sampleRate * 0.45) * plan.size) / sampleRate));
  const scratch = new Float32Array(plan.size);
  const power = new Float64Array(count);
  for (let f = 0; f < count; f += 1) {
    const { real, imag } = analyse(plan, x, (first + f) * plan.hop, scratch);
    let sum = 0;
    for (let k = lo; k <= hi; k += 1) sum += real[k] * real[k] + imag[k] * imag[k];
    power[f] = sum;
  }
  // Three-frame smoothing in the power domain steadies the dB envelope without moving decay slopes.
  const env = new Float64Array(count);
  for (let f = 0; f < count; f += 1) {
    const a = power[Math.max(0, f - 1)];
    const b = power[f];
    const c = power[Math.min(count - 1, f + 1)];
    env[f] = 10 * Math.log10((a + 2 * b + c) / 4 + 1e-30);
  }
  return { env, frameSeconds: plan.hop / sampleRate };
}

/**
 * Blind RT60 from a dB energy envelope. Every sliding window of ~120 ms whose envelope is a clean falling line (R^2 >= 0.85, a
 * drop of at least 2.5 dB, still 8 dB above the quietest part of the recording at its end) is a free-decay candidate; its slope
 * gives an RT60 (60 dB / slope). Speech offsets are faster than or equal to the room, never slower, so the room is the slow
 * end of the candidates: the 70th percentile, which also rejects the odd flat patch.
 */
export function estimateRt60FromEnvelope(env: Float64Array, frameSeconds: number): Rt60Estimate {
  const n = env.length;
  const window = Math.max(8, Math.round(0.12 / frameSeconds));
  if (n < window * 2) return { rt60: FALLBACK_RT60, confidence: 0, decays: 0 };
  const sorted = Float64Array.from(env).sort();
  const floor = sorted[Math.floor(n * 0.05)];
  const peak = sorted[Math.floor(n * 0.95)];
  if (peak - floor < 15) return { rt60: FALLBACK_RT60, confidence: 0, decays: 0 };
  const estimates: number[] = [];
  const step = Math.max(1, Math.round(window / 4));
  for (let start = 0; start + window <= n; start += step) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < window; i += 1) {
      const y = env[start + i];
      sx += i;
      sy += y;
      sxx += i * i;
      sxy += i * y;
      syy += y * y;
    }
    const denom = window * sxx - sx * sx;
    const slope = (window * sxy - sx * sy) / denom;
    if (!(slope < 0)) continue;
    const varY = window * syy - sy * sy;
    const r2 = varY > 0 ? (window * sxy - sx * sy) ** 2 / (denom * varY) : 0;
    const drop = -slope * (window - 1);
    const endLevel = env[start + window - 1];
    if (r2 < 0.85 || drop < 2.5 || endLevel < floor + 8) continue;
    const rt = 60 / (-slope / frameSeconds);
    if (rt >= MIN_RT60 * 0.8 && rt <= MAX_RT60 * 1.5) estimates.push(rt);
  }
  if (estimates.length < 4) return { rt60: FALLBACK_RT60, confidence: 0, decays: estimates.length };
  estimates.sort((a, b) => a - b);
  const rt60 = clamp(estimates[Math.floor((estimates.length - 1) * 0.7)], MIN_RT60, MAX_RT60);
  return { rt60, confidence: Math.min(1, estimates.length / 12), decays: estimates.length };
}

export function estimateRt60(x: Float32Array, sampleRate: number): Rt60Estimate {
  const { env, frameSeconds } = bandEnergyEnvelope(x, sampleRate);
  return estimateRt60FromEnvelope(env, frameSeconds);
}

/**
 * What the two sliders mean. Amount sets how much of the WPE-predicted late reverb is subtracted (linear, 0..1) and, scaled down,
 * how hard the spectral stage works after it. Sensitivity sets how soon after the direct sound the prediction starts (4, 3 or 2
 * frames of ~10.7 ms: higher is more aggressive and risks colouring the voice) and how much of the signal's energy the tail
 * model assumes to be reverberant.
 */
export function reverbTuning(params: ReduceReverbParams): { wpeStrength: number; wpeDelay: number; spectralAmount: number } {
  const amount = clamp(params.amount, 0, 100) / 100;
  const sensitivity = clamp(params.sensitivity, 0, 100) / 100;
  return { wpeStrength: amount, wpeDelay: Math.round(4 - 2 * sensitivity), spectralAmount: SPECTRAL_STAGE_SHARE * amount * 100 };
}

/** The spectral stage's own constants for its strength (0..100) and sensitivity (0..100). */
export function spectralTuning(params: ReduceReverbParams): { beta: number; floorDb: number; kappa: number } {
  const amount = clamp(params.amount, 0, 100) / 100;
  const sensitivity = clamp(params.sensitivity, 0, 100) / 100;
  // The gain floor is the deepest cut the stage may make, so it scales with Amount: below FLOOR_RAMP_AMOUNT it fades to 0 dB and
  // the stage (like WPE, which is linear in Amount) converges to the identity as Amount goes to 0 instead of keeping a 6 dB floor.
  const ramp = Math.min(1, amount / FLOOR_RAMP_AMOUNT);
  return { beta: 0.6 + 2.4 * amount, floorDb: -(6 + 22 * amount) * ramp, kappa: 0.35 + 0.9 * sensitivity };
}

/** Stage-2 strength (0..1, i.e. Amount 0..100 scaled to the stage's 35 % share) at which the gain floor reaches its full depth. */
const FLOOR_RAMP_AMOUNT = 0.1;

const SPECTRAL_STAGE_SHARE = 0.35;
const WPE_MAX_HZ = 8000;
const WPE_ITERATIONS = 3;
const YIELD_EVERY_FRAMES = 400;

export interface ReduceReverbResult {
  readonly output: Float32Array;
  readonly rt60: Rt60Estimate;
}

/** Stage 2: spectral late-reverb suppression of one channel (`params.amount` here is the stage's own strength). */
export async function spectralLateReverbChannel(x: Float32Array, sampleRate: number, params: ReduceReverbParams, options: ReduceReverbOptions = {}): Promise<ReduceReverbResult> {
  const plan = planFor(sampleRate);
  const { size, hop, bins, window, fft } = plan;
  const estimate: Rt60Estimate = options.rt60 !== undefined ? { rt60: clamp(options.rt60, MIN_RT60, MAX_RT60), confidence: 1, decays: -1 } : estimateRt60(x, sampleRate);
  const out = new Float32Array(x.length);
  if (x.length === 0) return { output: out, rt60: estimate };
  const { first, count } = frameCount(x.length, plan);
  const tuning = spectralTuning(params);
  const hopSeconds = hop / sampleRate;
  const rho = 10 ** ((-6 * hopSeconds) / estimate.rt60);
  const lag = Math.max(1, Math.round(EARLY_SECONDS / hopSeconds));
  const lateGain = tuning.kappa * (1 - rho) * rho ** lag * (0.5 + 0.5 * estimate.confidence);
  const floorGain = Math.min(10 ** (tuning.floorDb / 20), 1 - 1e-6);
  const xiMin = (floorGain * floorGain) / (1 - floorGain * floorGain);
  const alphaDd = 0.85;
  const alphaTime = 0.5;
  let meanPower = 0;
  for (let i = 0; i < x.length; i += 1) meanPower += x[i] * x[i];
  meanPower /= x.length;
  // Relative epsilon: the gain is a function of power ratios only, so a quieter decode of the same file gives the same result.
  const eps = meanPower * size * 1e-9 + 1e-30;
  const scratch = new Float32Array(size);
  const history: Float32Array[] = Array.from({ length: lag + 1 }, () => new Float32Array(bins));
  const smoothed = new Float32Array(bins);
  const late = new Float32Array(bins);
  const gains = new Float32Array(bins).fill(1);
  const prevPost = new Float32Array(bins);
  const power = new Float32Array(bins);
  const spreadPower = new Float32Array(bins);
  const kept = new Float32Array(bins);
  for (let f = 0; f < count; f += 1) {
    if (options.signal?.aborted) throw new ReverbCancelledError();
    if (f % YIELD_EVERY_FRAMES === 0 && f > 0) {
      options.onProgress?.(f / count);
      if (options.yieldNow) await options.yieldNow();
      if (options.signal?.aborted) throw new ReverbCancelledError();
    }
    const start = (first + f) * hop;
    const { real, imag } = analyse(plan, x, start, scratch);
    for (let k = 0; k < bins; k += 1) power[k] = real[k] * real[k] + imag[k] * imag[k];
    for (let k = 0; k < bins; k += 1) spreadPower[k] = (power[Math.max(0, k - 1)] + 2 * power[k] + power[Math.min(bins - 1, k + 1)]) * 0.25;
    const slot = history[f % history.length];
    const old = history[(f + 1) % history.length]; // `lag` frames ago once the ring is full
    for (let k = 0; k < bins; k += 1) late[k] = rho * late[k] + (f >= lag ? lateGain * old[k] : 0);
    for (let k = 0; k < bins; k += 1) {
      const lateEstimate = tuning.beta * late[k] + eps;
      const post = spreadPower[k] / lateEstimate;
      const ml = Math.max(post - 1, 0);
      const xi = Math.max(alphaDd * gains[k] * gains[k] * prevPost[k] + (1 - alphaDd) * ml, xiMin);
      const g = xi / (1 + xi);
      gains[k] = Math.max(floorGain, g);
      prevPost[k] = post;
    }
    // Light smoothing across frequency of the applied gain: single-bin gain spikes are what is heard as musical noise.
    for (let k = 0; k < bins; k += 1) {
      const smoothedGain = 0.25 * gains[Math.max(0, k - 1)] + 0.5 * gains[k] + 0.25 * gains[Math.min(bins - 1, k + 1)];
      // The tail model is fed with what is left after suppression (the estimate of the direct and early sound), not with the
      // reverberant input, so the tail of the tail is not counted twice.
      kept[k] = spreadPower[k] * smoothedGain * smoothedGain;
      real[k] *= smoothedGain;
      imag[k] *= smoothedGain;
      if (k > 0 && k < size / 2) {
        real[size - k] = real[k];
        imag[size - k] = -imag[k];
      }
    }
    imag[0] = 0;
    imag[size / 2] = 0;
    for (let k = 0; k < bins; k += 1) {
      smoothed[k] = f === 0 ? kept[k] : alphaTime * smoothed[k] + (1 - alphaTime) * kept[k];
      slot[k] = smoothed[k];
    }
    const time = fft.inverse(real, imag);
    for (let i = 0; i < size; i += 1) {
      const at = start + i;
      if (at >= 0 && at < x.length) out[at] += (time[i] * window[i]) * 0.5;
    }
  }
  options.onProgress?.(1);
  return { output: out, rt60: estimate };
}

/**
 * Reduce Reverb for one channel: WPE prediction-error dereverberation of the speech band, then spectral late-reverb suppression
 * with the blind RT60 for what the prediction leaves in the pauses. Measured against either stage alone in
 * `reverb-quality.test.ts`: WPE gives the SI-SDR gain, the spectral stage the cleaner pauses.
 */
export async function reduceReverbChannel(x: Float32Array, sampleRate: number, params: ReduceReverbParams, options: ReduceReverbOptions = {}): Promise<ReduceReverbResult> {
  const tuning = reverbTuning(params);
  const estimate: Rt60Estimate = options.rt60 !== undefined ? { rt60: clamp(options.rt60, MIN_RT60, MAX_RT60), confidence: 1, decays: -1 } : estimateRt60(x, sampleRate);
  if (!(params.amount > 0) || x.length === 0) return { output: Float32Array.from(x), rt60: estimate };
  const hopSeconds = wpeFrameSize(sampleRate) / 4 / sampleRate;
  const taps = clamp(Math.round(0.28 / hopSeconds), 16, 32);
  const share = (from: number, to: number) => (fraction: number) => options.onProgress?.(from + (to - from) * fraction);
  const control = { signal: options.signal, yieldNow: options.yieldNow };
  const predicted = await wpeChannel(x, sampleRate, { delay: tuning.wpeDelay, taps, iterations: WPE_ITERATIONS, strength: tuning.wpeStrength, maxHz: WPE_MAX_HZ }, { ...control, onProgress: share(0, 0.85) });
  const { output } = await spectralLateReverbChannel(predicted, sampleRate, { amount: tuning.spectralAmount, sensitivity: params.sensitivity }, { ...options, rt60: estimate.rt60, onProgress: share(0.85, 1) });
  // The stages can ring above a loud or clipped source: take the gain down around any overshoot instead of exceeding its peak.
  limitPeaks([output], peakOfChannels([x]), sampleRate);
  options.onProgress?.(1);
  return { output, rt60: estimate };
}
