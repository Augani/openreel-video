/**
 * Spectral editing DSP: STFT / inverse STFT, region attenuation and removal, and the spectrogram a
 * view draws.
 *
 * Analysis and synthesis use a periodic Hann window at 75 % overlap (2048 / 512). With the squared
 * window summing to a constant (1.5), the inverse STFT reconstructs the input to float precision.
 * Region edits do not rebuild the signal from modified frames. Each edit computes only the frames its
 * region touches and ADDS the (modified - original) frame difference back with the synthesis window,
 * so untouched audio is bit-identical, an edit that changes nothing changes nothing, and a long clip
 * with one small region costs a handful of FFTs. Everything here is pure and deterministic: the
 * preview, the export mixdown and the unit tests run this same code on the same samples.
 */
import { FFT } from "../fft";
import { analyseFrame, getStftPlan, hashUnit, stftFrameRange, type StftPlan } from "./spectral-stft";
import { applyMaskRegion } from "./spectral-mask-edit";

export * from "./spectral-stft";
import { activeSpectralRegions, regionAppliesToChannel, regionUsesMask, type SpectralRegion } from "./spectral-regions";

/** Bins between a removed band and the bins its fill is interpolated from (clears the Hann main lobe). */
const REF_BIN_GAP = 4;
/** Frames between a removed time span and the frames its fill is interpolated from (clears the window overlap). */
const REF_FRAME_GAP = 3;
/** Attenuation fades over this many bins outside the selected band. */
const FREQ_FEATHER_BINS = 3;

const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

function applyRegion(work: Float32Array, sampleRate: number, region: SpectralRegion, plan: StftPlan, channel: number): void {
  const { size, hop, window, norm } = plan;
  const half = size / 2;
  const nyquist = sampleRate / 2;
  if (region.lowHz >= nyquist || work.length === 0) return;
  const binHz = sampleRate / size;
  const kLo = Math.max(0, Math.min(half, Math.floor(region.lowHz / binHz)));
  const kHi = Math.max(kLo, Math.min(half, Math.ceil(Math.min(region.highHz, nyquist) / binHz)));
  const ramp = hop / sampleRate;
  const range = stftFrameRange(work.length, plan);
  const frameCentre = (m: number) => (m * hop + half) / sampleRate;
  const timeWeight = (m: number): number => {
    const c = frameCentre(m);
    return smooth((c - region.startTime) / ramp + 0.5) * smooth((region.endTime - c) / ramp + 0.5);
  };
  let mFirst = Math.max(range.first, Math.ceil(((region.startTime - ramp / 2) * sampleRate - half) / hop));
  let mLast = Math.min(range.last, Math.floor(((region.endTime + ramp / 2) * sampleRate - half) / hop));
  while (mFirst <= mLast && timeWeight(mFirst) <= 1e-6) mFirst += 1;
  while (mLast >= mFirst && timeWeight(mLast) <= 1e-6) mLast -= 1;
  if (mLast < mFirst) return;

  const remove = region.mode === "remove";
  const gain = Math.pow(10, region.gainDb / 20);
  const scratch = new Float32Array(size);
  const dr = new Float32Array(size);
  const di = new Float32Array(size);

  // What a removed region is filled from: neighbouring bins in the same frame when the region is
  // narrower in frequency than in time (a hum band), otherwise the neighbouring frames (a click).
  const lowRef = kLo - REF_BIN_GAP >= 0 ? kLo - REF_BIN_GAP : -1;
  const highRef = kHi + REF_BIN_GAP <= half ? kHi + REF_BIN_GAP : -1;
  const binCount = kHi - kLo + 1;
  const frameCount = mLast - mFirst + 1;
  const frameRefA = mFirst - REF_FRAME_GAP >= range.first ? mFirst - REF_FRAME_GAP : null;
  const frameRefB = mLast + REF_FRAME_GAP <= range.last ? mLast + REF_FRAME_GAP : null;
  const freqAxis = remove && binCount <= frameCount && (lowRef >= 0 || highRef >= 0);
  let magA: Float32Array | null = null;
  let magB: Float32Array | null = null;
  if (remove && !freqAxis) {
    const magnitudes = (m: number): Float32Array => {
      const s = analyseFrame(plan, work, m * hop, scratch);
      const out = new Float32Array(half + 1);
      for (let k = 0; k <= half; k += 1) out[k] = Math.hypot(s.real[k], s.imag[k]);
      return out;
    };
    if (frameRefA !== null) magA = magnitudes(frameRefA);
    if (frameRefB !== null) magB = magnitudes(frameRefB);
  }

  const sampleStart = mFirst * hop;
  const delta = new Float32Array((mLast - mFirst) * hop + size);
  for (let m = mFirst; m <= mLast; m += 1) {
    const weight = timeWeight(m);
    if (weight <= 1e-6) continue;
    const { real, imag } = analyseFrame(plan, work, m * hop, scratch);
    dr.fill(0);
    di.fill(0);
    const put = (k: number, re: number, im: number) => {
      dr[k] = re;
      di[k] = im;
      if (k > 0 && k < half) {
        dr[size - k] = re;
        di[size - k] = -im;
      }
    };
    if (!remove) {
      const from = Math.max(0, kLo - FREQ_FEATHER_BINS + 1);
      const to = Math.min(half, kHi + FREQ_FEATHER_BINS - 1);
      for (let k = from; k <= to; k += 1) {
        const feather = k < kLo ? 1 - (kLo - k) / FREQ_FEATHER_BINS : k > kHi ? 1 - (k - kHi) / FREQ_FEATHER_BINS : 1;
        const scale = weight * feather * (gain - 1);
        const edge = k === 0 || k === half;
        put(k, real[k] * scale, edge ? 0 : imag[k] * scale);
      }
    } else {
      const along = frameRefA !== null && frameRefB !== null ? (m - frameRefA) / (frameRefB - frameRefA) : 0;
      for (let k = kLo; k <= kHi; k += 1) {
        let target = 0;
        if (freqAxis) {
          const a = lowRef >= 0 ? Math.hypot(real[lowRef], imag[lowRef]) : null;
          const b = highRef >= 0 ? Math.hypot(real[highRef], imag[highRef]) : null;
          target = a !== null && b !== null ? a + ((b - a) * (k - lowRef)) / (highRef - lowRef) : (a ?? b ?? 0);
        } else if (magA && magB) target = magA[k] + (magB[k] - magA[k]) * along;
        else target = (magA ?? magB)?.[k] ?? 0;
        const phase = 2 * Math.PI * hashUnit(k, m, channel);
        const edge = k === 0 || k === half;
        const fillRe = edge ? target * (Math.cos(phase) >= 0 ? 1 : -1) : target * Math.cos(phase);
        const fillIm = edge ? 0 : target * Math.sin(phase);
        put(k, (fillRe - real[k]) * weight, edge ? 0 : (fillIm - imag[k]) * weight);
      }
    }
    const time = plan.fft.inverse(dr, di);
    const base = m * hop - sampleStart;
    for (let i = 0; i < size; i += 1) delta[base + i] += time[i] * window[i];
  }
  for (let i = 0; i < delta.length; i += 1) {
    const at = sampleStart + i;
    if (at >= 0 && at < work.length) work[at] += delta[i] / norm;
  }
}

/**
 * Applies a region list to one channel and returns the repaired channel. With no active region the SAME
 * array is returned (nothing is copied or changed); otherwise a new array. Regions apply in order, each
 * one to the result of the previous, so an overlapping attenuation after a removal acts on the filled audio.
 */
export function applySpectralRegionsToChannel(
  signal: Float32Array,
  sampleRate: number,
  regions: readonly SpectralRegion[],
  channel = 0,
): Float32Array {
  const active = activeSpectralRegions(regions).filter((region) => regionAppliesToChannel(region, channel));
  if (active.length === 0 || signal.length === 0) return signal;
  const work = Float32Array.from(signal);
  const plan = getStftPlan();
  for (const region of active) {
    if (regionUsesMask(region)) applyMaskRegion(work, sampleRate, region, plan, channel);
    else applyRegion(work, sampleRate, region, plan, channel);
  }
  return work;
}

/** All channels of a clip's source; identical samples whether called in a worker, in the export engine or in a test. */
export function applySpectralRegions(channels: readonly Float32Array[], sampleRate: number, regions: readonly SpectralRegion[]): Float32Array[] {
  return channels.map((data, index) => applySpectralRegionsToChannel(data, sampleRate, regions, index));
}

/* ------------------------------------------------------------------ */
/* Spectrogram for the view                                            */
/* ------------------------------------------------------------------ */

export interface SpectralViewOptions {
  /** Source-time window in seconds (default: the whole signal). */
  readonly startTime?: number;
  readonly endTime?: number;
  /** FFT size of the display analysis (default 4096: finer low-frequency resolution than the edit STFT). */
  readonly fftSize?: number;
  /** Columns to produce at most (default 900). */
  readonly maxFrames?: number;
  /** Level mapped to the darkest colour, dBFS (default -100). 0 dBFS (a full-scale sine) is the brightest. */
  readonly minDb?: number;
}

export interface SpectralView {
  readonly frames: number;
  /** Linear bins from 0 to Nyquist (exclusive). */
  readonly bins: number;
  readonly sampleRate: number;
  readonly fftSize: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly minDb: number;
  /** frames x bins, 0..255 over [minDb, 0] dBFS. */
  readonly data: Uint8Array;
}

/** Magnitude spectrogram of the mono mix of `channels` over a window, on an absolute dBFS scale so colours do not shift with zoom or edits. */
export function computeSpectralView(channels: readonly Float32Array[], sampleRate: number, options: SpectralViewOptions = {}): SpectralView {
  const fftSize = options.fftSize ?? 4096;
  const length = channels[0]?.length ?? 0;
  const duration = length / sampleRate;
  const startTime = Math.max(0, Math.min(duration, options.startTime ?? 0));
  const endTime = Math.max(startTime, Math.min(duration, options.endTime ?? duration));
  const minDb = options.minDb ?? -100;
  const maxFrames = Math.max(1, Math.floor(options.maxFrames ?? 900));
  const from = Math.floor(startTime * sampleRate);
  const to = Math.max(from, Math.min(length, Math.ceil(endTime * sampleRate)));
  const span = to - from;
  const hop = Math.max(32, Math.min(fftSize, Math.floor(span / maxFrames) || 32));
  const frames = Math.max(1, Math.min(maxFrames, Math.ceil(span / hop)));
  const bins = fftSize / 2;
  const fft = new FFT(fftSize);
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
  const reference = fftSize / 4; // peak bin magnitude of a full-scale sine under a Hann window
  const data = new Uint8Array(frames * bins);
  const frame = new Float32Array(fftSize);
  const inv = 1 / Math.max(1, channels.length);
  for (let f = 0; f < frames; f += 1) {
    // Frame centred on its column: analysis windows extend past the view edges so zooming does not blank them.
    const begin = from + Math.min(span, f * hop + Math.floor(hop / 2)) - fftSize / 2;
    for (let i = 0; i < fftSize; i += 1) {
      const at = begin + i;
      let sum = 0;
      if (at >= 0 && at < length) for (const channel of channels) sum += channel[at];
      frame[i] = sum * inv * window[i];
    }
    const { real, imag } = fft.forward(frame);
    for (let k = 0; k < bins; k += 1) {
      const db = 20 * Math.log10(Math.hypot(real[k], imag[k]) / reference + 1e-12);
      data[f * bins + k] = Math.max(0, Math.min(255, Math.round(((db - minDb) / -minDb) * 255)));
    }
  }
  return { frames, bins, sampleRate, fftSize, startTime, endTime, minDb, data };
}
