import { KWeightingFilter } from "./k-weighting";
import { TruePeakMeter, linearToDb } from "./true-peak";
import { SpeechGate } from "./dialogue-gate";

/**
 * Streaming ITU-R BS.1770-4 / EBU R128 loudness meter.
 *
 *  - momentary  (M): 400 ms window
 *  - short-term (S): 3 s window
 *  - integrated (I): 400 ms blocks, 75% overlap, two-stage gate
 *    (absolute -70 LUFS, relative -10 LU)
 *  - loudness range (LRA): EBU Tech 3342 on the 3 s short-term values
 *    (absolute -70 LUFS, relative -20 LU, 10th..95th percentile)
 *  - true peak: 4x oversampled (dBTP)
 *
 * Audio is consumed in arbitrarily sized chunks, so the same class drives the
 * live playback meter and the offline analysis of an entire mixdown.
 */

export const LOUDNESS_OFFSET_DB = -0.691;
export const ABSOLUTE_GATE_LUFS = -70;
export const RELATIVE_GATE_LU = -10;
export const LRA_RELATIVE_GATE_LU = -20;
const SUBBLOCKS_PER_MOMENTARY = 4;
const SUBBLOCKS_PER_SHORT_TERM = 30;
/** Silence floor reported instead of -Infinity so UIs and JSON stay finite. */
export const SILENCE_LUFS = -Infinity;

export interface LoudnessMeterOptions {
  /** Per-channel BS.1770 weights (L/R/C = 1, surround = 1.41, LFE = 0). */
  readonly channelWeights?: readonly number[];
  /** Treat a mono input as dual-mono (+3.01 LU), as for playback on stereo. */
  readonly dualMono?: boolean;
  /** Also measure dialogue-gated loudness (speech blocks only), see `SpeechGate`. */
  readonly dialogueGate?: boolean;
}

export interface LoudnessSnapshot {
  readonly momentary: number;
  readonly shortTerm: number;
  readonly integrated: number;
  readonly loudnessRange: number;
  readonly momentaryMax: number;
  readonly shortTermMax: number;
  /** True peak in dBTP. */
  readonly truePeak: number;
  /** Sample peak in dBFS. */
  readonly samplePeak: number;
  /** Audio duration analysed so far, seconds. */
  readonly duration: number;
  /** Integrated loudness of the dialogue blocks only (-Infinity when none); present when the gate ran. */
  readonly dialogueIntegrated?: number;
  /** Share (0..1) of the program-gated blocks classified as dialogue; present when the gate ran. */
  readonly dialogueFraction?: number;
}

export function defaultChannelWeights(channels: number): number[] {
  if (channels === 6) return [1, 1, 1, 0, 1.41, 1.41];
  if (channels === 5) return [1, 1, 1, 1.41, 1.41];
  return Array.from({ length: channels }, () => 1);
}

const energyToLufs = (energy: number): number =>
  energy > 0 ? LOUDNESS_OFFSET_DB + 10 * Math.log10(energy) : SILENCE_LUFS;
const lufsToEnergy = (lufs: number): number => Math.pow(10, (lufs - LOUDNESS_OFFSET_DB) / 10);

/** BS.1770-4 gated loudness of a list of 400 ms block energies. */
export function gatedLoudness(blockEnergies: ArrayLike<number>, count = blockEnergies.length): number {
  const absGate = lufsToEnergy(ABSOLUTE_GATE_LUFS);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (blockEnergies[i] > absGate) {
      sum += blockEnergies[i];
      n++;
    }
  }
  if (n === 0) return SILENCE_LUFS;
  const relGate = (sum / n) * Math.pow(10, RELATIVE_GATE_LU / 10);
  let sum2 = 0;
  let n2 = 0;
  for (let i = 0; i < count; i++) {
    const e = blockEnergies[i];
    if (e > absGate && e > relGate) {
      sum2 += e;
      n2++;
    }
  }
  return n2 === 0 ? SILENCE_LUFS : energyToLufs(sum2 / n2);
}

/** Loudness of every block, with no absolute or relative gating. */
export function ungatedLoudness(blockEnergies: ArrayLike<number>, count = blockEnergies.length): number {
  if (count === 0) return SILENCE_LUFS;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += blockEnergies[i];
  return energyToLufs(sum / count);
}

/** EBU Tech 3342 loudness range (LU) from short-term window energies. */
export function loudnessRangeOf(shortTermEnergies: ArrayLike<number>, count = shortTermEnergies.length): number {
  const absGate = lufsToEnergy(ABSOLUTE_GATE_LUFS);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (shortTermEnergies[i] > absGate) {
      sum += shortTermEnergies[i];
      n++;
    }
  }
  if (n === 0) return 0;
  const relGate = (sum / n) * Math.pow(10, LRA_RELATIVE_GATE_LU / 10);
  const kept: number[] = [];
  for (let i = 0; i < count; i++) {
    const e = shortTermEnergies[i];
    if (e > absGate && e > relGate) kept.push(energyToLufs(e));
  }
  if (kept.length < 2) return 0;
  kept.sort((a, b) => a - b);
  const at = (p: number): number => {
    const pos = (kept.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return kept[lo] + (kept[hi] - kept[lo]) * (pos - lo);
  };
  return at(0.95) - at(0.1);
}

export class LoudnessMeter {
  readonly sampleRate: number;
  readonly channelCount: number;
  private readonly weights: number[];
  private readonly filters: KWeightingFilter[];
  private readonly truePeakMeter: TruePeakMeter;
  private readonly subblockLength: number;
  private subblockFill = 0;
  private subblockSum = 0;
  private totalSamples = 0;
  /** Ring of the most recent sub-block mean-square energies. */
  private readonly recent = new Float64Array(SUBBLOCKS_PER_SHORT_TERM);
  private subblockCount = 0;
  private blockEnergies: number[] = [];
  private readonly speechGate?: SpeechGate;
  private dialogueFlags: boolean[] = [];
  private shortTermEnergies: number[] = [];
  private momentaryEnergy = 0;
  private shortTermEnergy = 0;
  private momentaryMaxEnergy = 0;
  private shortTermMaxEnergy = 0;

  constructor(sampleRate: number, channels: number, options: LoudnessMeterOptions = {}) {
    if (!(sampleRate > 0)) throw new RangeError("sampleRate must be positive");
    if (!(channels >= 1)) throw new RangeError("channels must be at least 1");
    this.sampleRate = sampleRate;
    this.channelCount = channels;
    const base = options.channelWeights ? [...options.channelWeights] : defaultChannelWeights(channels);
    while (base.length < channels) base.push(1);
    this.weights = base.slice(0, channels);
    if (options.dualMono && channels === 1) this.weights[0] = 2;
    this.filters = Array.from({ length: channels }, () => new KWeightingFilter(sampleRate));
    this.truePeakMeter = new TruePeakMeter(channels);
    this.subblockLength = Math.max(1, Math.round(sampleRate * 0.1));
    if (options.dialogueGate) this.speechGate = new SpeechGate(sampleRate);
  }

  /** Feed one chunk (one array per channel, equal lengths). */
  process(channels: ArrayLike<number>[], length = channels[0]?.length ?? 0): void {
    if (length <= 0) return;
    this.truePeakMeter.process(channels, length);
    const n = Math.min(this.channelCount, channels.length);
    let i = 0;
    while (i < length) {
      const take = Math.min(length - i, this.subblockLength - this.subblockFill);
      let sum = 0;
      for (let c = 0; c < n; c++) {
        const w = this.weights[c];
        const filter = this.filters[c];
        const data = channels[c];
        let acc = 0;
        for (let k = i; k < i + take; k++) {
          const y = filter.process(data[k]);
          acc += y * y;
        }
        sum += w * acc;
      }
      if (this.speechGate) {
        for (let k = i; k < i + take; k++) {
          let mono = 0;
          for (let c = 0; c < n; c++) mono += channels[c][k];
          this.speechGate.push(mono / n);
        }
      }
      this.subblockSum += sum;
      this.subblockFill += take;
      this.totalSamples += take;
      i += take;
      if (this.subblockFill === this.subblockLength) this.closeSubblock();
    }
  }

  private closeSubblock(): void {
    const energy = this.subblockSum / this.subblockLength;
    this.subblockSum = 0;
    this.subblockFill = 0;
    this.recent[this.subblockCount % SUBBLOCKS_PER_SHORT_TERM] = energy;
    this.subblockCount++;
    const meanOfLast = (n: number): number => {
      let s = 0;
      for (let k = 1; k <= n; k++) {
        s += this.recent[(this.subblockCount - k) % SUBBLOCKS_PER_SHORT_TERM];
      }
      return s / n;
    };
    if (this.subblockCount >= SUBBLOCKS_PER_MOMENTARY) {
      this.momentaryEnergy = meanOfLast(SUBBLOCKS_PER_MOMENTARY);
      this.blockEnergies.push(this.momentaryEnergy);
      if (this.speechGate) this.dialogueFlags.push(this.speechGate.isSpeech());
      if (this.momentaryEnergy > this.momentaryMaxEnergy) this.momentaryMaxEnergy = this.momentaryEnergy;
    }
    if (this.subblockCount >= SUBBLOCKS_PER_SHORT_TERM) {
      this.shortTermEnergy = meanOfLast(SUBBLOCKS_PER_SHORT_TERM);
      this.shortTermEnergies.push(this.shortTermEnergy);
      if (this.shortTermEnergy > this.shortTermMaxEnergy) this.shortTermMaxEnergy = this.shortTermEnergy;
    }
  }

  momentary(): number {
    return energyToLufs(this.momentaryEnergy);
  }

  shortTerm(): number {
    return energyToLufs(this.shortTermEnergy);
  }

  integrated(): number {
    return gatedLoudness(this.blockEnergies);
  }

  /** Loudness with no gating at all (every 400 ms block counts). */
  ungatedIntegrated(): number {
    return ungatedLoudness(this.blockEnergies);
  }

  /** BS.1770 gated loudness over the dialogue blocks only; -Infinity without dialogue. */
  dialogueIntegrated(): number {
    const kept: number[] = [];
    for (let i = 0; i < this.blockEnergies.length; i++) if (this.dialogueFlags[i]) kept.push(this.blockEnergies[i]);
    return gatedLoudness(kept);
  }

  /** Fraction of the blocks above the absolute gate that are dialogue. */
  dialogueFraction(): number {
    const absGate = lufsToEnergy(ABSOLUTE_GATE_LUFS);
    let audible = 0;
    let speech = 0;
    for (let i = 0; i < this.blockEnergies.length; i++) {
      if (this.blockEnergies[i] <= absGate) continue;
      audible++;
      if (this.dialogueFlags[i]) speech++;
    }
    return audible === 0 ? 0 : speech / audible;
  }

  loudnessRange(): number {
    return loudnessRangeOf(this.shortTermEnergies);
  }

  /** True peak in dBTP. */
  truePeak(): number {
    return linearToDb(this.truePeakMeter.linear);
  }

  samplePeak(): number {
    return linearToDb(this.truePeakMeter.samplePeakLinear);
  }

  snapshot(): LoudnessSnapshot {
    return {
      momentary: this.momentary(),
      shortTerm: this.shortTerm(),
      integrated: this.integrated(),
      loudnessRange: this.loudnessRange(),
      momentaryMax: energyToLufs(this.momentaryMaxEnergy),
      shortTermMax: energyToLufs(this.shortTermMaxEnergy),
      truePeak: this.truePeak(),
      samplePeak: this.samplePeak(),
      duration: this.totalSamples / this.sampleRate,
      ...(this.speechGate
        ? { dialogueIntegrated: this.dialogueIntegrated(), dialogueFraction: this.dialogueFraction() }
        : {}),
    };
  }

  reset(): void {
    this.filters.forEach((f) => f.reset());
    this.truePeakMeter.reset();
    this.subblockFill = 0;
    this.subblockSum = 0;
    this.totalSamples = 0;
    this.recent.fill(0);
    this.subblockCount = 0;
    this.blockEnergies = [];
    this.dialogueFlags = [];
    this.speechGate?.reset();
    this.shortTermEnergies = [];
    this.momentaryEnergy = 0;
    this.shortTermEnergy = 0;
    this.momentaryMaxEnergy = 0;
    this.shortTermMaxEnergy = 0;
  }
}

/** One-shot measurement of complete channel data. */
export function measureLoudness(
  channels: ArrayLike<number>[],
  sampleRate: number,
  options?: LoudnessMeterOptions,
): LoudnessSnapshot {
  const meter = new LoudnessMeter(sampleRate, channels.length, options);
  meter.process(channels);
  return meter.snapshot();
}
