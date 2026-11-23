/**
 * Cheap check used before offering "heal" on a selection: heal continues a steady partial that is present on both
 * sides of a SHORT gap, so healing only a slice of a persistent whistle or hum leaves it in. This looks at the source
 * audio just before and just after the region and reports whether a narrow band keeps steady, prominent energy on
 * both sides, then asks what heal would really do with it:
 *   - up to ~0.2 s the partial is carried in full (heal's tonal gap ramp is 1 below 0.26 s), so the answer is yes;
 *   - beyond the end of that ramp (0.52 s plus the mask's margin) heal carries nothing, so the answer is no;
 *   - in between the carry is partial and depends on the signal, so heal is run on a cropped copy (a second of audio
 *     around the region) and the partial's level inside the region is compared before and after.
 * Pure and deterministic; reads at most a second of audio per side and runs heal on the region only when that is needed.
 */
import { applySpectralRegionsToChannel } from "./spectral-dsp";
import { TONAL_GAP_NONE_S } from "./spectral-mask-edit";
import { sanitizeSpectralRegions } from "./spectral-regions";
import { getStftPlan, stftForward } from "./spectral-stft";

const FFT = 4096;
const HOP = 2048;
/** Seconds of audio inspected on each side of the region. */
const SIDE_SECONDS = 0.5;
/** A steady partial stands this far above the bins just outside the band, and above the band's own median. */
const PROMINENCE_DB = 10;
const OVER_BAND_MEDIAN_DB = 14;
const STEADY_FRACTION = 0.6;
/** Below this slice length heal carries a steady partial in full (heal's ramp is 1 up to 0.26 s; the mask margin eats a little of it). */
const CARRIED_IN_FULL_S = 0.2;
/** Above this slice length heal carries nothing (the end of the ramp, 0.52 s, plus the frames of margin around the mask). */
const NOT_CARRIED_S = TONAL_GAP_NONE_S + 0.1;
/** Audio kept on each side of the region when heal is run to see what it does. */
const CROP_SECONDS = 0.5;
/** The partial counts as kept when heal leaves it within this many dB of the original level (10 dB is a third of the amplitude: still audible as a tone). */
const KEPT_WITHIN_DB = 10;

export interface HealRegionBand {
  readonly startTime: number;
  readonly endTime: number;
  readonly lowHz: number;
  readonly highHz: number;
}

export interface HealAdvice {
  /** True when a steady partial in the band continues on both sides of the region, so heal would carry it through. */
  readonly continuesBothSides: boolean;
  readonly before: boolean;
  readonly after: boolean;
  /** Length of the slice heal would bridge, seconds. */
  readonly gapSeconds: number;
  /**
   * Level change of the partial inside the region once healed, dB (0 = kept as it was, -10 = ten dB quieter). Null when
   * heal was not run: the slice is short enough that heal carries the partial in full, long enough that it carries none,
   * or the partial is not steady on both sides.
   */
  readonly retainedDb: number | null;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? -180;
};

/** The bin of the steady partial in the band, or -1 when the band holds none. */
function steadyBin(segment: Float32Array, sampleRate: number, lowHz: number, highHz: number): number {
  if (segment.length < FFT) return -1;
  const plan = getStftPlan(FFT, HOP);
  const frames = stftForward(segment, plan);
  const half = FFT / 2;
  const binHz = sampleRate / FFT;
  const lo = Math.max(1, Math.floor(lowHz / binHz) - 1);
  const hi = Math.min(half - 1, Math.ceil(highHz / binHz) + 1);
  const peaks: number[] = [];
  let counted = 0;
  for (let f = 0; f < frames.real.length; f += 1) {
    const m = frames.first + f;
    if (m < 0 || m * HOP + FFT > segment.length) continue;
    const db = (k: number): number => 20 * Math.log10(Math.hypot(frames.real[f][k], frames.imag[f][k]) + 1e-9);
    let peak = -180;
    let peakBin = lo;
    const inBand: number[] = [];
    for (let k = lo; k <= hi; k += 1) {
      const level = db(k);
      inBand.push(level);
      if (level > peak) {
        peak = level;
        peakBin = k;
      }
    }
    const ring: number[] = [];
    for (let d = 6; d <= 16; d += 1) {
      if (lo - d >= 0) ring.push(db(lo - d));
      if (hi + d <= half) ring.push(db(hi + d));
    }
    counted += 1;
    // A tone sticks out of the band's own bins as well as of its surroundings (broadband noise does not).
    if (ring.length > 0 && peak - median(ring) >= PROMINENCE_DB && (inBand.length < 6 || peak - median(inBand) >= OVER_BAND_MEDIAN_DB)) peaks.push(peakBin);
  }
  if (counted === 0 || peaks.length / counted < STEADY_FRACTION) return -1;
  // Steady means the same pitch: most prominent peaks sit within one bin of the commonest one.
  const sorted = [...peaks].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return sorted.filter((bin) => Math.abs(bin - mid) <= 1).length / counted >= STEADY_FRACTION ? mid : -1;
}

/** Mean level, dB, of the three bins around `bin` over the analysis frames that fit in `segment`. */
function partialDb(segment: Float32Array, bin: number): number {
  if (segment.length < FFT) return -180;
  const plan = getStftPlan(FFT, HOP);
  const frames = stftForward(segment, plan);
  let sum = 0;
  let counted = 0;
  for (let f = 0; f < frames.real.length; f += 1) {
    const m = frames.first + f;
    if (m < 0 || m * HOP + FFT > segment.length) continue;
    let power = 0;
    for (let k = bin - 1; k <= bin + 1; k += 1) power += frames.real[f][k] ** 2 + frames.imag[f][k] ** 2;
    sum += power;
    counted += 1;
  }
  return counted === 0 ? -180 : 10 * Math.log10(sum / counted + 1e-18);
}

/** Runs heal on a cropped copy of the audio around the region and returns how much the partial at `bin` changed inside it. */
function healRetainedDb(mono: Float32Array, sampleRate: number, region: HealRegionBand, bin: number): number | null {
  const cropStart = Math.max(0, Math.floor((region.startTime - CROP_SECONDS) * sampleRate));
  const cropEnd = Math.min(mono.length, Math.ceil((region.endTime + CROP_SECONDS) * sampleRate));
  const local = mono.slice(cropStart, cropEnd);
  const offset = cropStart / sampleRate;
  const regions = sanitizeSpectralRegions([
    { id: "advice", enabled: true, mode: "heal", gainDb: -120, startTime: region.startTime - offset, endTime: region.endTime - offset, lowHz: region.lowHz, highHz: region.highHz },
  ]);
  if (regions.length === 0) return null;
  const healed = applySpectralRegionsToChannel(local, sampleRate, regions);
  // Judge the middle of the slice, away from the edges where the original is still cross-faded in.
  const inner = Math.min(0.05 * sampleRate, (region.endTime - region.startTime) * sampleRate * 0.1);
  const from = Math.max(0, Math.ceil((region.startTime - offset) * sampleRate + inner));
  const to = Math.min(local.length, Math.floor((region.endTime - offset) * sampleRate - inner));
  if (to - from < FFT) return null;
  return partialDb(healed.subarray(from, to), bin) - partialDb(local.subarray(from, to), bin);
}

/** Whether healing this band would carry a steady partial through the region instead of removing it (see the file header for how). */
export function adviseHeal(mono: Float32Array, sampleRate: number, region: HealRegionBand): HealAdvice {
  const startSample = Math.floor(region.startTime * sampleRate);
  const endSample = Math.ceil(region.endTime * sampleRate);
  const side = Math.max(FFT, Math.floor(SIDE_SECONDS * sampleRate));
  const gapSeconds = Math.max(0, region.endTime - region.startTime);
  const beforeBin = startSample >= FFT ? steadyBin(mono.subarray(Math.max(0, startSample - side), startSample), sampleRate, region.lowHz, region.highHz) : -1;
  const afterBin = mono.length - endSample >= FFT ? steadyBin(mono.subarray(endSample, Math.min(mono.length, endSample + side)), sampleRate, region.lowHz, region.highHz) : -1;
  const before = beforeBin >= 0;
  const after = afterBin >= 0;
  if (!before || !after) return { continuesBothSides: false, before, after, gapSeconds, retainedDb: null };
  if (gapSeconds <= CARRIED_IN_FULL_S) return { continuesBothSides: true, before, after, gapSeconds, retainedDb: null };
  if (gapSeconds >= NOT_CARRIED_S) return { continuesBothSides: false, before, after, gapSeconds, retainedDb: null };
  const retainedDb = healRetainedDb(mono, sampleRate, region, beforeBin);
  // A slice in the ramp where heal could not be judged (too short an interior) is treated as carried: the safe side to warn on.
  return { continuesBothSides: retainedDb === null || retainedDb > -KEPT_WITHIN_DB, before, after, gapSeconds, retainedDb };
}
