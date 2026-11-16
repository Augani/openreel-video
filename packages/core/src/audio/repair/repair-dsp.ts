/**
 * Audio repair DSP: DeHum, DeClick, DeClip, DeEss, DeReverb and Gate.
 *
 * Every processor is a plain, allocation-free, sample-streaming state machine
 * with a fixed latency. The SAME class runs inside the AudioWorklet (realtime
 * preview) and the OfflineAudioContext worklet (mixdown / export / stems), so
 * both paths produce the same samples; the only input that can differ is the
 * block size, and nothing here depends on it. The module imports only the
 * pure FFT so it can be bundled into a worklet.
 */
import { FFT } from "../fft";

export type RepairEffectType =
  | "deHum"
  | "deClick"
  | "deClip"
  | "deEss"
  | "deReverb"
  | "gate"
  | "brickwallLimiter"
  | "lowPass";

export type RepairParams = Readonly<Record<string, number | string | boolean>>;

export interface RepairProcessor {
  /** Samples of delay between input and output (constant for the processor's life). */
  readonly latency: number;
  /** Current gain reduction in dB (>= 0) for effects that have a meter. */
  readonly meter: number;
  setParams(params: RepairParams): void;
  /** Process `frames` samples; inputs/outputs hold one Float32Array per channel. */
  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void;
  reset(): void;
}

const num = (params: RepairParams, key: string, def: number): number => {
  const v = params[key];
  if (typeof v === "boolean") return v ? 1 : 0;
  return typeof v === "number" && Number.isFinite(v) ? v : def;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dbToLin = (db: number) => Math.pow(10, db / 20);
const linToDb = (lin: number) => 20 * Math.log10(Math.max(lin, 1e-12));

/* ------------------------------------------------------------------ */
/* RepairBiquad                                                              */
/* ------------------------------------------------------------------ */

export interface RepairBiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

export function notchCoefficients(sampleRate: number, frequency: number, q: number): RepairBiquadCoefficients {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return { b0: 1 / a0, b1: (-2 * cos) / a0, b2: 1 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Constant 0 dB peak-gain band-pass. */
export function bandpassCoefficients(sampleRate: number, frequency: number, q: number): RepairBiquadCoefficients {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

export class RepairBiquad {
  private z1 = 0;
  private z2 = 0;
  constructor(public c: RepairBiquadCoefficients) {}
  process(x: number): number {
    const { b0, b1, b2, a1, a2 } = this.c;
    const y = b0 * x + this.z1;
    this.z1 = b1 * x - a1 * y + this.z2;
    this.z2 = b2 * x - a2 * y;
    return y;
  }
  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/** Magnitude response (linear) of one biquad at `frequency`. */
export function biquadMagnitude(c: RepairBiquadCoefficients, sampleRate: number, frequency: number): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cw + c.b2 * c2;
  const ni = -(c.b1 * sw + c.b2 * s2);
  const dr = 1 + c.a1 * cw + c.a2 * c2;
  const di = -(c.a1 * sw + c.a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

abstract class ChannelProcessor<T> implements RepairProcessor {
  protected states: T[] = [];
  protected params: RepairParams = {};
  meter = 0;
  abstract readonly latency: number;
  constructor(protected readonly sampleRate: number) {}
  abstract setParams(params: RepairParams): void;
  protected abstract makeState(): T;
  protected abstract run(state: T, input: Float32Array, output: Float32Array, frames: number, channel: number): void;
  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    while (this.states.length < inputs.length) this.states.push(this.makeState());
    for (let c = 0; c < inputs.length; c += 1) this.run(this.states[c], inputs[c], outputs[c], frames, c);
  }
  reset(): void {
    this.states = [];
    this.meter = 0;
  }
}

/** Cubic Hermite fill of `buf[from..to]` (inclusive) from the samples around it. */
function hermiteFill(buf: Float32Array, mask: number, from: number, to: number): void {
  const p = buf[(from - 1) & mask];
  const q = buf[(to + 1) & mask];
  const n = to - from + 2;
  const m0 = p - buf[(from - 2) & mask];
  const m1 = buf[(to + 2) & mask] - q;
  for (let k = 1; k < n; k += 1) {
    const t = k / n;
    const t2 = t * t;
    const t3 = t2 * t;
    buf[(from - 1 + k) & mask] =
      (2 * t3 - 3 * t2 + 1) * p + (t3 - 2 * t2 + t) * n * m0 + (-2 * t3 + 3 * t2) * q + (t3 - t2) * n * m1;
  }
}

/* ------------------------------------------------------------------ */
/* DeHum                                                                */
/* ------------------------------------------------------------------ */

export const DEHUM_DEFAULTS = { frequency: 60, harmonics: 4, q: 30, depth: 1 } as const;

interface HumState {
  filters: RepairBiquad[];
}

/** Series notch cascade on the mains fundamental and its harmonics. Zero latency. */
export class DeHumProcessor extends ChannelProcessor<HumState> {
  readonly latency = 0;
  private freq: number = DEHUM_DEFAULTS.frequency;
  private harmonics: number = DEHUM_DEFAULTS.harmonics;
  private q: number = DEHUM_DEFAULTS.q;
  private depth: number = DEHUM_DEFAULTS.depth;
  constructor(sampleRate: number, params: RepairParams = {}) {
    super(sampleRate);
    this.setParams(params);
  }
  setParams(params: RepairParams): void {
    this.params = params;
    this.freq = clamp(num(params, "frequency", DEHUM_DEFAULTS.frequency), 20, 400);
    this.harmonics = Math.round(clamp(num(params, "harmonics", DEHUM_DEFAULTS.harmonics), 1, 12));
    this.q = clamp(num(params, "q", DEHUM_DEFAULTS.q), 2, 200);
    this.depth = clamp(num(params, "depth", DEHUM_DEFAULTS.depth), 0, 1);
    for (const s of this.states) this.configure(s);
  }
  private configure(s: HumState): void {
    const coeffs: RepairBiquadCoefficients[] = [];
    for (let h = 1; h <= this.harmonics; h += 1) {
      const f = this.freq * h;
      if (f >= this.sampleRate * 0.45) break;
      coeffs.push(notchCoefficients(this.sampleRate, f, this.q));
    }
    while (s.filters.length < coeffs.length) s.filters.push(new RepairBiquad(coeffs[s.filters.length]));
    s.filters.length = coeffs.length;
    coeffs.forEach((c, i) => (s.filters[i].c = c));
  }
  protected makeState(): HumState {
    const s: HumState = { filters: [] };
    this.configure(s);
    return s;
  }
  protected run(s: HumState, input: Float32Array, output: Float32Array, frames: number): void {
    const depth = this.depth;
    for (let i = 0; i < frames; i += 1) {
      const x = input[i];
      let y = x;
      for (let f = 0; f < s.filters.length; f += 1) y = s.filters[f].process(y);
      output[i] = depth >= 1 ? y : x + depth * (y - x);
    }
  }
}

/* ------------------------------------------------------------------ */
/* DeClick                                                              */
/* ------------------------------------------------------------------ */

export const DECLICK_DEFAULTS = { sensitivity: 0.5, maxWidth: 24 } as const;
const DECLICK_RING = 256;

interface ClickState {
  ring: Float32Array;
  flags: Uint8Array;
  n: number;
  level: number;
  runStart: number;
  runLength: number;
  repaired: number;
}

const clickThreshold = (sensitivity: number): number => 13 - 9 * clamp(sensitivity, 0, 1);
const CLICK_FLOOR = 2e-3;
const CLICK_LEVEL_COEFF = 0.004;
const CLICK_WARMUP = 480;

/**
 * Impulse-noise removal. A sample whose deviation from the average of its
 * neighbours is many times the running typical deviation is a click; a run of
 * up to `maxWidth` flagged samples is replaced by a cubic interpolation of the
 * clean samples around it. Wider disturbances are left alone (they are signal).
 */
export class DeClickProcessor extends ChannelProcessor<ClickState> {
  private k = clickThreshold(DECLICK_DEFAULTS.sensitivity);
  private maxWidth: number = DECLICK_DEFAULTS.maxWidth;
  /** Clicks repaired since the last reset (all channels). */
  repairedCount = 0;
  latency = DECLICK_DEFAULTS.maxWidth + 6;
  constructor(sampleRate: number, params: RepairParams = {}) {
    super(sampleRate);
    this.setParams(params);
  }
  setParams(params: RepairParams): void {
    this.params = params;
    this.k = clickThreshold(num(params, "sensitivity", DECLICK_DEFAULTS.sensitivity));
    // Latency must not change while a stream is running; width is fixed at construction time
    // unless the processor has not seen audio yet.
    const width = Math.round(clamp(num(params, "maxWidth", DECLICK_DEFAULTS.maxWidth), 1, 64));
    if (this.states.length === 0) {
      this.maxWidth = width;
      this.latency = width + 6;
    } else {
      this.maxWidth = Math.min(width, this.latency - 6);
    }
  }
  protected makeState(): ClickState {
    return {
      ring: new Float32Array(DECLICK_RING),
      flags: new Uint8Array(DECLICK_RING),
      n: 0,
      level: 0,
      runStart: -1,
      runLength: 0,
      repaired: 0,
    };
  }
  reset(): void {
    super.reset();
    this.repairedCount = 0;
  }
  protected run(s: ClickState, input: Float32Array, output: Float32Array, frames: number): void {
    const mask = DECLICK_RING - 1;
    const delay = this.latency;
    for (let i = 0; i < frames; i += 1) {
      const n = s.n;
      s.ring[n & mask] = input[i];
      s.flags[n & mask] = 0;
      // Examine sample c = n - 1 now that its right neighbour exists.
      const c = n - 1;
      if (c >= 1) {
        const x = s.ring[c & mask];
        const r = Math.abs(x - 0.5 * (s.ring[(c - 1) & mask] + s.ring[(c + 1) & mask]));
        const threshold = this.k * s.level + CLICK_FLOOR;
        // The first few hundred samples only train the level estimate.
        const warming = c < CLICK_WARMUP;
        const flagged = !warming && r > threshold;
        if (flagged) {
          s.flags[c & mask] = 1;
        } else {
          s.level += (warming ? 0.02 : CLICK_LEVEL_COEFF) * (r - s.level);
        }
        if (flagged) {
          if (s.runStart < 0) s.runStart = c;
          s.runLength = c - s.runStart + 1;
        } else if (s.runStart >= 0) {
          this.finishRun(s, mask);
        }
        if (s.runStart >= 0 && s.runLength > this.maxWidth) {
          // Too wide to be an impulse: it is signal; forget the run.
          s.runStart = -1;
          s.runLength = 0;
        }
      }
      s.n = n + 1;
      const o = n - delay;
      output[i] = o >= 0 ? s.ring[o & mask] : 0;
    }
  }
  private finishRun(s: ClickState, mask: number): void {
    const from = s.runStart;
    const to = s.runStart + s.runLength - 1;
    s.runStart = -1;
    s.runLength = 0;
    if (from - 2 < 0) return;
    hermiteFill(s.ring, mask, from, to);
    s.repaired += 1;
    this.repairedCount += 1;
  }
}

/** Positions (sample indices) of clicks the DeClick detector would repair. */
export function detectClicks(samples: Float32Array, sensitivity = 0.5, maxWidth = 24): number[] {
  const proc = new DeClickProcessor(48000, { sensitivity, maxWidth });
  const positions: number[] = [];
  const input = [new Float32Array(1)];
  const output = [new Float32Array(1)];
  let before = 0;
  for (let i = 0; i < samples.length; i += 1) {
    input[0][0] = samples[i];
    proc.process(input, output, 1);
    if (proc.repairedCount !== before) {
      before = proc.repairedCount;
      positions.push(Math.max(0, i - proc.latency));
    }
  }
  return positions;
}

/* ------------------------------------------------------------------ */
/* DeClip                                                               */
/* ------------------------------------------------------------------ */

export const DECLIP_DEFAULTS = { threshold: -0.5, maxRun: 64 } as const;
const DECLIP_RING = 512;

interface ClipState {
  ring: Float32Array;
  n: number;
  runStart: number;
  runSign: number;
  skipping: boolean;
}

/**
 * Clipped-sample reconstruction. Runs of two or more samples at or beyond the
 * clip threshold are replaced by a cubic Hermite spline through the unclipped
 * samples on both sides (matching their slopes), which lets the waveform
 * overshoot the clip level the way the original signal did.
 */
export class DeClipProcessor extends ChannelProcessor<ClipState> {
  private threshold = dbToLin(DECLIP_DEFAULTS.threshold);
  private maxRun: number = DECLIP_DEFAULTS.maxRun;
  latency = DECLIP_DEFAULTS.maxRun + 4;
  constructor(sampleRate: number, params: RepairParams = {}) {
    super(sampleRate);
    this.setParams(params);
  }
  setParams(params: RepairParams): void {
    this.params = params;
    this.threshold = dbToLin(clamp(num(params, "threshold", DECLIP_DEFAULTS.threshold), -24, 0));
    const run = Math.round(clamp(num(params, "maxRun", DECLIP_DEFAULTS.maxRun), 4, 160));
    if (this.states.length === 0) {
      this.maxRun = run;
      this.latency = run + 4;
    } else {
      this.maxRun = Math.min(run, this.latency - 4);
    }
  }
  protected makeState(): ClipState {
    return { ring: new Float32Array(DECLIP_RING), n: 0, runStart: -1, runSign: 0, skipping: false };
  }
  protected run(s: ClipState, input: Float32Array, output: Float32Array, frames: number): void {
    const mask = DECLIP_RING - 1;
    const delay = this.latency;
    const thr = this.threshold;
    for (let i = 0; i < frames; i += 1) {
      const n = s.n;
      s.ring[n & mask] = input[i];
      // Scan sample m = n - 1; its right neighbour x[n] is the slope anchor.
      const m = n - 1;
      if (m >= 2) {
        const x = s.ring[m & mask];
        const sign = x >= thr ? 1 : x <= -thr ? -1 : 0;
        if (s.skipping && sign !== s.runSign) s.skipping = false;
        if (!s.skipping) {
          if (s.runStart >= 0 && sign !== s.runSign) {
            this.finish(s, mask, m - 1);
            s.runStart = -1;
          }
          if (s.runStart < 0) {
            if (sign !== 0) {
              s.runStart = m;
              s.runSign = sign;
            }
          } else if (m - s.runStart + 1 > this.maxRun) {
            // Too long to be a clipped peak: genuine overload, leave it.
            s.runStart = -1;
            s.skipping = true;
          }
        }
      }
      s.n = n + 1;
      const o = n - delay;
      output[i] = o >= 0 ? s.ring[o & mask] : 0;
    }
  }
  private finish(s: ClipState, mask: number, end: number): void {
    const start = s.runStart;
    if (end - start + 1 < 2 || start - 2 < 0) return;
    // A real clip is flat: samples barely differ. A loud, smooth peak is not clipped.
    const spread = Math.abs(s.ring[start & mask] - s.ring[end & mask]);
    let max = 0;
    for (let k = start; k <= end; k += 1) max = Math.max(max, Math.abs(s.ring[k & mask]));
    if (spread > 0.15 * max) return;
    hermiteFill(s.ring, mask, start, end);
  }
}

/* ------------------------------------------------------------------ */
/* DeEss                                                                */
/* ------------------------------------------------------------------ */

export const DEESS_DEFAULTS = {
  frequency: 6500,
  bandwidthQ: 1.5,
  threshold: -30,
  ratio: 6,
  attack: 0.001,
  release: 0.05,
  listen: 0,
} as const;

interface DeEssState {
  band: RepairBiquad;
  env: number;
}

/**
 * Frequency-selective compressor. Only the sibilance band (a band-pass around
 * `frequency`) is detected and attenuated, subtracting the removed part from
 * the full signal, so everything outside the band passes untouched. `listen`
 * outputs the detected band. Channels are linked to the loudest. Zero latency.
 */
export class DeEssProcessor extends ChannelProcessor<DeEssState> {
  readonly latency = 0;
  private frequency: number = DEESS_DEFAULTS.frequency;
  private q: number = DEESS_DEFAULTS.bandwidthQ;
  private threshold = dbToLin(DEESS_DEFAULTS.threshold);
  private thresholdDb: number = DEESS_DEFAULTS.threshold;
  private ratio: number = DEESS_DEFAULTS.ratio;
  private attackCoeff = 0;
  private releaseCoeff = 0;
  private listen = false;
  private readonly bandScratch = new Float64Array(16);
  constructor(sampleRate: number, params: RepairParams = {}) {
    super(sampleRate);
    this.setParams(params);
  }
  setParams(params: RepairParams): void {
    this.params = params;
    this.frequency = clamp(num(params, "frequency", DEESS_DEFAULTS.frequency), 1000, this.sampleRate * 0.45);
    this.q = clamp(num(params, "bandwidthQ", DEESS_DEFAULTS.bandwidthQ), 0.3, 8);
    this.thresholdDb = clamp(num(params, "threshold", DEESS_DEFAULTS.threshold), -80, 0);
    this.threshold = dbToLin(this.thresholdDb);
    this.ratio = clamp(num(params, "ratio", DEESS_DEFAULTS.ratio), 1, 20);
    const attack = clamp(num(params, "attack", DEESS_DEFAULTS.attack), 0.0001, 0.1);
    const release = clamp(num(params, "release", DEESS_DEFAULTS.release), 0.005, 1);
    this.attackCoeff = 1 - Math.exp(-1 / (attack * this.sampleRate));
    this.releaseCoeff = 1 - Math.exp(-1 / (release * this.sampleRate));
    this.listen = num(params, "listen", 0) >= 0.5;
    const coeffs = bandpassCoefficients(this.sampleRate, this.frequency, this.q);
    for (const s of this.states) s.band.c = coeffs;
  }
  protected makeState(): DeEssState {
    return { band: new RepairBiquad(bandpassCoefficients(this.sampleRate, this.frequency, this.q)), env: 0 };
  }
  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    while (this.states.length < inputs.length) this.states.push(this.makeState());
    const channels = inputs.length;
    let worst = 0;
    for (let i = 0; i < frames; i += 1) {
      let peak = 0;
      for (let c = 0; c < channels; c += 1) {
        const b = this.states[c].band.process(inputs[c][i]);
        this.bandScratch[c] = b;
        peak = Math.max(peak, Math.abs(b));
      }
      // Shared envelope (linked channels): fast attack, slow release peak follower.
      const s0 = this.states[0];
      s0.env += (peak > s0.env ? this.attackCoeff : this.releaseCoeff) * (peak - s0.env);
      let gain = 1;
      if (s0.env > this.threshold) {
        const overDb = linToDb(s0.env) - this.thresholdDb;
        const reductionDb = overDb * (1 - 1 / this.ratio);
        gain = dbToLin(-reductionDb);
        worst = Math.max(worst, reductionDb);
      }
      for (let c = 0; c < channels; c += 1) {
        outputs[c][i] = this.listen ? this.bandScratch[c] : inputs[c][i] - this.bandScratch[c] * (1 - gain);
      }
    }
    this.meter = worst;
  }
  protected run(): void {
    /* process() is overridden: the envelope is shared across channels */
  }
}

/* ------------------------------------------------------------------ */
/* Gate                                                                 */
/* ------------------------------------------------------------------ */

export const GATE_DEFAULTS = { threshold: -50, range: -30, attack: 0.002, hold: 0.05, release: 0.15 } as const;

interface GateState {
  env: number;
  holdLeft: number;
  gain: number;
}

/** Downward expander/gate with hold, linked across channels. Zero latency. */
export class GateProcessor extends ChannelProcessor<GateState> {
  readonly latency = 0;
  private threshold = dbToLin(GATE_DEFAULTS.threshold);
  private closedGain = dbToLin(GATE_DEFAULTS.range);
  private holdSamples = 0;
  private attackCoeff = 0;
  private releaseCoeff = 0;
  private envRelease = 0;
  constructor(sampleRate: number, params: RepairParams = {}) {
    super(sampleRate);
    this.setParams(params);
  }
  setParams(params: RepairParams): void {
    this.params = params;
    this.threshold = dbToLin(clamp(num(params, "threshold", GATE_DEFAULTS.threshold), -90, 0));
    this.closedGain = dbToLin(clamp(num(params, "range", GATE_DEFAULTS.range), -90, 0));
    this.holdSamples = Math.round(clamp(num(params, "hold", GATE_DEFAULTS.hold), 0, 2) * this.sampleRate);
    const attack = clamp(num(params, "attack", GATE_DEFAULTS.attack), 0.0002, 0.5);
    const release = clamp(num(params, "release", GATE_DEFAULTS.release), 0.005, 3);
    this.attackCoeff = 1 - Math.exp(-1 / (attack * this.sampleRate));
    this.releaseCoeff = 1 - Math.exp(-1 / (release * this.sampleRate));
    this.envRelease = 1 - Math.exp(-1 / (0.005 * this.sampleRate));
  }
  protected makeState(): GateState {
    return { env: 0, holdLeft: 0, gain: 1 };
  }
  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    while (this.states.length < inputs.length) this.states.push(this.makeState());
    const s = this.states[0];
    const channels = inputs.length;
    let minGain = 1;
    for (let i = 0; i < frames; i += 1) {
      let peak = 0;
      for (let c = 0; c < channels; c += 1) peak = Math.max(peak, Math.abs(inputs[c][i]));
      s.env = peak > s.env ? peak : s.env + this.envRelease * (peak - s.env);
      let target: number;
      if (s.env >= this.threshold) {
        s.holdLeft = this.holdSamples;
        target = 1;
      } else if (s.holdLeft > 0) {
        s.holdLeft -= 1;
        target = 1;
      } else {
        target = this.closedGain;
      }
      s.gain += (target > s.gain ? this.attackCoeff : this.releaseCoeff) * (target - s.gain);
      minGain = Math.min(minGain, s.gain);
      for (let c = 0; c < channels; c += 1) outputs[c][i] = inputs[c][i] * s.gain;
    }
    this.meter = linToDb(1 / Math.max(minGain, 1e-6));
  }
  protected run(): void {
    /* process() is overridden */
  }
}

/* ------------------------------------------------------------------ */
/* DeReverb                                                             */
/* ------------------------------------------------------------------ */

export const DEREVERB_DEFAULTS = { amount: 0.6, rt60: 0.8, floor: -18 } as const;
const REVERB_FFT = 1024;
const REVERB_HOP = 256;
/** Frames between a frame and the earlier frame its late-reverb estimate is taken from. */
const REVERB_LAG = 10;

interface ReverbState {
  inFrame: Float32Array;
  pending: Float32Array;
  pendingCount: number;
  outAcc: Float32Array;
  outQueue: Float32Array;
  outPos: number;
  history: Float32Array[];
  historyPos: number;
  gains: Float32Array;
  frames: number;
}

/**
 * Late-reverberation suppression by spectral subtraction (Lebart-style). The
 * late-reverb power in every STFT bin is predicted from the power one lag
 * earlier decayed by the room's RT60, then subtracted. It removes the smeared
 * tail of a roomy recording; it cannot remove early reflections, and strong
 * settings make speech sound thin or "watery". Latency is one FFT frame.
 */
export class DeReverbProcessor extends ChannelProcessor<ReverbState> {
  readonly latency = REVERB_FFT;
  private amount: number = DEREVERB_DEFAULTS.amount;
  private rt60: number = DEREVERB_DEFAULTS.rt60;
  private floorGain = dbToLin(DEREVERB_DEFAULTS.floor);
  private readonly fft = new FFT(REVERB_FFT);
  private readonly window = new Float32Array(REVERB_FFT);
  private readonly scratch = new Float32Array(REVERB_FFT);
  private readonly bins = REVERB_FFT / 2 + 1;
  constructor(sampleRate: number, params: RepairParams = {}) {
    super(sampleRate);
    for (let i = 0; i < REVERB_FFT; i += 1) this.window[i] = Math.sin((Math.PI * (i + 0.5)) / REVERB_FFT);
    this.setParams(params);
  }
  setParams(params: RepairParams): void {
    this.params = params;
    this.amount = clamp(num(params, "amount", DEREVERB_DEFAULTS.amount), 0, 1);
    this.rt60 = clamp(num(params, "rt60", DEREVERB_DEFAULTS.rt60), 0.1, 5);
    this.floorGain = dbToLin(clamp(num(params, "floor", DEREVERB_DEFAULTS.floor), -40, 0));
  }
  protected makeState(): ReverbState {
    return {
      inFrame: new Float32Array(REVERB_FFT),
      pending: new Float32Array(REVERB_HOP),
      pendingCount: 0,
      outAcc: new Float32Array(REVERB_FFT),
      outQueue: new Float32Array(REVERB_HOP),
      outPos: 0,
      history: Array.from({ length: REVERB_LAG + 1 }, () => new Float32Array(this.bins)),
      historyPos: 0,
      gains: new Float32Array(this.bins).fill(1),
      frames: 0,
    };
  }
  protected run(s: ReverbState, input: Float32Array, output: Float32Array, frames: number): void {
    for (let i = 0; i < frames; i += 1) {
      output[i] = s.outQueue[s.outPos];
      s.outPos += 1;
      s.pending[s.pendingCount] = input[i];
      s.pendingCount += 1;
      if (s.pendingCount === REVERB_HOP) {
        this.processFrame(s);
        s.pendingCount = 0;
        s.outPos = 0;
      }
    }
  }
  private processFrame(s: ReverbState): void {
    const N = REVERB_FFT;
    s.inFrame.copyWithin(0, REVERB_HOP);
    s.inFrame.set(s.pending, N - REVERB_HOP);
    const windowed = this.scratch;
    for (let i = 0; i < N; i += 1) windowed[i] = s.inFrame[i] * this.window[i];
    const { real, imag } = this.fft.forward(windowed);
    const power = s.history[s.historyPos];
    for (let k = 0; k < this.bins; k += 1) power[k] = real[k] * real[k] + imag[k] * imag[k];
    const lagged = s.history[(s.historyPos + 1) % s.history.length]; // oldest = REVERB_LAG frames ago
    const lagSeconds = (REVERB_LAG * REVERB_HOP) / this.sampleRate;
    const decay = Math.exp((-2 * 6.9078 * lagSeconds) / this.rt60);
    const beta = 3 * this.amount;
    const floorPow = this.floorGain * this.floorGain;
    for (let k = 0; k < this.bins; k += 1) {
      const lo = Math.max(0, k - 1);
      const hi = Math.min(this.bins - 1, k + 1);
      const ps = (power[lo] + power[k] + power[hi]) / 3 + 1e-12;
      const late = (((lagged[lo] + lagged[k] + lagged[hi]) / 3) + 0) * decay;
      const target = Math.max(floorPow, 1 - (beta * late) / ps);
      const g = Math.sqrt(target);
      // Fast to duck, slower to recover: avoids musical-noise flutter.
      s.gains[k] = g < s.gains[k] ? 0.4 * s.gains[k] + 0.6 * g : 0.8 * s.gains[k] + 0.2 * g;
    }
    s.historyPos = (s.historyPos + 1) % s.history.length;
    for (let k = 0; k < this.bins; k += 1) {
      real[k] *= s.gains[k];
      imag[k] *= s.gains[k];
      if (k > 0 && k < N / 2) {
        real[N - k] = real[k];
        imag[N - k] = -imag[k];
      }
    }
    const time = this.fft.inverse(real, imag);
    // Sine analysis x sine synthesis windows at 75% overlap sum to 2.
    for (let i = 0; i < N; i += 1) s.outAcc[i] += time[i] * this.window[i] * 0.5;
    s.outQueue.set(s.outAcc.subarray(0, REVERB_HOP));
    s.outAcc.copyWithin(0, REVERB_HOP);
    s.outAcc.fill(0, N - REVERB_HOP);
    s.frames += 1;
  }
}

/* ------------------------------------------------------------------ */
/* Brickwall limiter (lookahead, true-peak)                              */
/* ------------------------------------------------------------------ */

const OVERSAMPLE = 8;
const OS_TAPS = 32;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 60; k += 1) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** Kaiser-windowed sinc polyphase bank for the 8x peak detector (unity DC gain per phase). */
const OS_PHASES: Float64Array[] = (() => {
  const total = OVERSAMPLE * OS_TAPS;
  const center = (total - 1) / 2;
  const denom = besselI0(9);
  const h = new Float64Array(total);
  for (let n = 0; n < total; n += 1) {
    const t = (n - center) / OVERSAMPLE;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const r = (2 * n) / (total - 1) - 1;
    h[n] = sinc * (besselI0(9 * Math.sqrt(Math.max(0, 1 - r * r))) / denom);
  }
  return Array.from({ length: OVERSAMPLE }, (_, ph) => {
    const phase = new Float64Array(OS_TAPS);
    let sum = 0;
    for (let t = 0; t < OS_TAPS; t += 1) {
      phase[t] = h[t * OVERSAMPLE + ph];
      sum += phase[t];
    }
    for (let t = 0; t < OS_TAPS; t += 1) phase[t] /= sum;
    return phase;
  });
})();

/**
 * Streaming 8x peak detector for one channel. (The 4x ITU-R BS.1770 meter can
 * read up to ~0.7 dB under the real inter-sample peak; 8x is within ~0.05 dB.)
 */
class PeakOversampler {
  private readonly history = new Float64Array(OS_TAPS * 2);
  private pos = 0;
  /** Largest absolute oversampled value for the points that this sample completes. */
  push(x: number): number {
    const hist = this.history;
    hist[this.pos] = x;
    hist[this.pos + OS_TAPS] = x;
    this.pos = (this.pos + 1) % OS_TAPS;
    const newest = this.pos + OS_TAPS - 1;
    let peak = 0;
    for (let ph = 0; ph < OVERSAMPLE; ph += 1) {
      const c = OS_PHASES[ph];
      let acc = 0;
      for (let t = 0; t < OS_TAPS; t += 1) acc += c[t] * hist[newest - t];
      const a = acc < 0 ? -acc : acc;
      if (a > peak) peak = a;
    }
    return peak;
  }
}

/**
 * The limiter aims this far under the requested ceiling. The detector's 8x
 * estimate is a little low on content near Nyquist and the gain ramp is not
 * constant across the taps that reconstruct a peak; this margin keeps the
 * output under the ceiling when measured by an independent 16x reference.
 */
const BRICKWALL_SAFETY_DB = -0.25;

export const BRICKWALL_DEFAULTS = { ceiling: -1, release: 0.1 } as const;
/** Fixed lookahead of the brickwall limiter. Constant so plugin delay compensation stays exact. */
export const BRICKWALL_LOOKAHEAD_SECONDS = 0.005;
/**
 * The 16-tap interpolator that finds inter-sample peaks reports a peak up to 15
 * samples after the first sample it depends on. The gain smoothing window is
 * shortened by that much (see BrickwallLimiterProcessor) so a detected peak is
 * already in the gain of every sample that contributes to it.
 */
const BRICKWALL_DETECTOR_SPREAD = OS_TAPS - 1;
const BRICKWALL_MIN_LOOKAHEAD = 2 * OS_TAPS;

export const brickwallLookaheadSamples = (sampleRate: number): number =>
  Math.max(BRICKWALL_MIN_LOOKAHEAD, Math.round(sampleRate * BRICKWALL_LOOKAHEAD_SECONDS));

/**
 * Lookahead brickwall limiter, linked across channels. Detection runs on the
 * 8x oversampled signal (plus the samples themselves); the gain is a sliding minimum over the lookahead window smoothed
 * by a moving average, so every peak, inter-sample peaks included, is
 * attenuated before it reaches the output. A release smoother only ever slows
 * the gain recovery, so it can never let a peak through. Output is delayed by
 * `latency` samples.
 */
export class BrickwallLimiterProcessor implements RepairProcessor {
  readonly latency: number;
  meter = 0;
  private ceiling = dbToLin(BRICKWALL_DEFAULTS.ceiling + BRICKWALL_SAFETY_DB);
  private releaseCoeff = 0;
  private interpolators: PeakOversampler[] = [];
  private delay: Float32Array[] = [];
  private delayPos = 0;
  private readonly dqIndex: Float64Array;
  private readonly dqValue: Float64Array;
  private dqHead = 0;
  private dqTail = 0;
  private frame = 0;
  private readonly avgRing: Float64Array;
  private avgSum: number;
  private releaseGain = 1;

  constructor(private readonly sampleRate: number, params: RepairParams = {}) {
    this.latency = brickwallLookaheadSamples(sampleRate);
    this.dqIndex = new Float64Array(this.latency + 2);
    this.dqValue = new Float64Array(this.latency + 2);
    this.avgRing = new Float64Array(this.latency - BRICKWALL_DETECTOR_SPREAD).fill(1);
    this.avgSum = this.avgRing.length;
    this.setParams(params);
  }

  setParams(params: RepairParams): void {
    this.ceiling = dbToLin(clamp(num(params, "ceiling", BRICKWALL_DEFAULTS.ceiling), -24, 0) + BRICKWALL_SAFETY_DB);
    const release = clamp(num(params, "release", BRICKWALL_DEFAULTS.release), 0.01, 1);
    this.releaseCoeff = 1 - Math.exp(-1 / (release * this.sampleRate));
  }

  private ensureChannels(count: number): void {
    while (this.interpolators.length < count) {
      this.interpolators.push(new PeakOversampler());
      this.delay.push(new Float32Array(this.latency));
    }
  }

  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    const channels = inputs.length;
    this.ensureChannels(channels);
    const size = this.dqIndex.length;
    const ring = this.avgRing.length;
    let minGain = 1;
    for (let i = 0; i < frames; i += 1) {
      let peak = 0;
      for (let c = 0; c < channels; c += 1) {
        const x = inputs[c][i];
        const p = this.interpolators[c].push(x);
        // The oversampled grid is offset by an eighth of a sample, so the sample itself is checked too.
        if (p > peak) peak = p;
        if (x > peak) peak = x;
        else if (-x > peak) peak = -x;
      }
      const gt = peak > this.ceiling ? this.ceiling / peak : 1;
      while (this.dqTail > this.dqHead && this.dqValue[(this.dqTail - 1) % size] >= gt) this.dqTail -= 1;
      this.dqIndex[this.dqTail % size] = this.frame;
      this.dqValue[this.dqTail % size] = gt;
      this.dqTail += 1;
      while (this.dqIndex[this.dqHead % size] <= this.frame - this.latency - 1) this.dqHead += 1;
      const min = this.dqValue[this.dqHead % size];
      const at = this.frame % ring;
      this.avgSum += min - this.avgRing[at];
      this.avgRing[at] = min;
      if (this.frame % 4096 === 0) {
        let sum = 0;
        for (let k = 0; k < ring; k += 1) sum += this.avgRing[k];
        this.avgSum = sum;
      }
      this.frame += 1;
      const avg = Math.min(1, this.avgSum / ring);
      this.releaseGain = avg < this.releaseGain ? avg : this.releaseGain + this.releaseCoeff * (avg - this.releaseGain);
      const gain = Math.min(avg, this.releaseGain);
      if (gain < minGain) minGain = gain;
      for (let c = 0; c < channels; c += 1) {
        const line = this.delay[c];
        const old = line[this.delayPos];
        line[this.delayPos] = inputs[c][i];
        outputs[c][i] = old * gain;
      }
      this.delayPos = (this.delayPos + 1) % this.latency;
    }
    this.meter = linToDb(1 / Math.max(minGain, 1e-6));
  }

  reset(): void {
    this.interpolators = [];
    this.delay = [];
    this.delayPos = 0;
    this.dqHead = 0;
    this.dqTail = 0;
    this.frame = 0;
    this.avgRing.fill(1);
    this.avgSum = this.avgRing.length;
    this.releaseGain = 1;
    this.meter = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Low-pass filter                                                       */
/* ------------------------------------------------------------------ */

export const LOWPASS_DEFAULTS = { frequency: 12000, slope: 12 } as const;

/** RBJ low-pass biquad. */
export function lowpassCoefficients(sampleRate: number, frequency: number, q: number): RepairBiquadCoefficients {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Q of each second-order section of an `order`-pole Butterworth low-pass. */
export function butterworthQs(order: number): number[] {
  const sections = Math.floor(order / 2);
  return Array.from({ length: sections }, (_, k) => 1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * order))));
}

/** Zero-latency Butterworth low-pass, 12 to 48 dB per octave (cascaded 2nd-order sections). */
export class LowPassProcessor implements RepairProcessor {
  readonly latency = 0;
  readonly meter = 0;
  private frequency: number = LOWPASS_DEFAULTS.frequency;
  private sections = 1;
  private banks: RepairBiquad[][] = [];
  private coeffs: RepairBiquadCoefficients[] = [];

  constructor(private readonly sampleRate: number, params: RepairParams = {}) {
    this.setParams(params);
  }

  private computeCoefficients(): RepairBiquadCoefficients[] {
    const f = clamp(this.frequency, 20, this.sampleRate * 0.45);
    return butterworthQs(this.sections * 2).map((q) => lowpassCoefficients(this.sampleRate, f, q));
  }

  setParams(params: RepairParams): void {
    this.frequency = clamp(num(params, "frequency", LOWPASS_DEFAULTS.frequency), 100, 20000);
    this.sections = clamp(Math.round(num(params, "slope", LOWPASS_DEFAULTS.slope) / 12), 1, 4);
    const coeffs = (this.coeffs = this.computeCoefficients());
    for (const bank of this.banks) {
      while (bank.length < coeffs.length) bank.push(new RepairBiquad(coeffs[bank.length]));
      bank.length = coeffs.length;
      coeffs.forEach((c, i) => (bank[i].c = c));
    }
  }

  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    const coeffs = this.coeffs;
    while (this.banks.length < inputs.length) this.banks.push(coeffs.map((c) => new RepairBiquad(c)));
    for (let c = 0; c < inputs.length; c += 1) {
      const bank = this.banks[c];
      for (let i = 0; i < frames; i += 1) {
        let x = inputs[c][i];
        for (let s = 0; s < bank.length; s += 1) x = bank[s].process(x);
        outputs[c][i] = x;
      }
    }
  }

  reset(): void {
    this.banks = [];
  }
}

/* ------------------------------------------------------------------ */
/* Linked N-channel compressor (surround)                                */
/* ------------------------------------------------------------------ */

export const LINKED_COMPRESSOR_DEFAULTS = {
  threshold: -24,
  ratio: 4,
  attack: 0.003,
  release: 0.25,
  knee: 30,
  makeupGain: 0,
} as const;

/** The fixed 6 ms lookahead of Web Audio's DynamicsCompressorNode, so the two are interchangeable for delay compensation. */
export const linkedCompressorLookaheadSamples = (sampleRate: number): number => Math.floor(0.006 * sampleRate);

/**
 * Feed-forward compressor for any number of channels. ONE detector (the
 * loudest channel, sample by sample) drives ONE gain that is applied to every
 * channel, so a 5.1 clip keeps its image: a loud centre pulls the surrounds
 * down by the same amount. Web Audio's DynamicsCompressorNode is limited to
 * two channels, which is why surround clips need this. Soft knee, attack and
 * release on the gain in dB, and the same 6 ms lookahead as the native node.
 */
export class LinkedCompressorProcessor implements RepairProcessor {
  readonly latency: number;
  meter = 0;
  private threshold: number = LINKED_COMPRESSOR_DEFAULTS.threshold;
  private ratio: number = LINKED_COMPRESSOR_DEFAULTS.ratio;
  private knee: number = LINKED_COMPRESSOR_DEFAULTS.knee;
  private makeup = 1;
  private attackCoeff = 0;
  private releaseCoeff = 0;
  /** Current gain reduction in dB (>= 0). */
  private reduction = 0;
  private delay: Float32Array[] = [];
  private delayPos = 0;

  constructor(private readonly sampleRate: number, params: RepairParams = {}) {
    this.latency = linkedCompressorLookaheadSamples(sampleRate);
    this.setParams(params);
  }

  setParams(params: RepairParams): void {
    const d = LINKED_COMPRESSOR_DEFAULTS;
    this.threshold = clamp(num(params, "threshold", d.threshold), -60, 0);
    this.ratio = clamp(num(params, "ratio", d.ratio), 1, 20);
    this.knee = clamp(num(params, "knee", d.knee), 0, 40);
    this.makeup = dbToLin(clamp(num(params, "makeupGain", d.makeupGain), 0, 24));
    const attack = clamp(num(params, "attack", d.attack), 0.0005, 1);
    const release = clamp(num(params, "release", d.release), 0.01, 3);
    this.attackCoeff = Math.exp(-1 / (attack * this.sampleRate));
    this.releaseCoeff = Math.exp(-1 / (release * this.sampleRate));
  }

  /** Static gain reduction (dB, >= 0) for an input level in dB: soft knee, then ratio. */
  private computeReduction(levelDb: number): number {
    const over = levelDb - this.threshold;
    const slope = 1 - 1 / this.ratio;
    if (2 * over < -this.knee) return 0;
    if (this.knee > 0 && 2 * Math.abs(over) <= this.knee) {
      const x = over + this.knee / 2;
      return (slope * x * x) / (2 * this.knee);
    }
    return slope * over;
  }

  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    const channels = inputs.length;
    const size = Math.max(1, this.latency);
    while (this.delay.length < channels) this.delay.push(new Float32Array(size));
    let maxReduction = 0;
    for (let i = 0; i < frames; i += 1) {
      let peak = 0;
      for (let c = 0; c < channels; c += 1) {
        const x = Math.abs(inputs[c][i]);
        if (x > peak) peak = x;
      }
      const target = peak > 1e-9 ? this.computeReduction(linToDb(peak)) : 0;
      const coeff = target > this.reduction ? this.attackCoeff : this.releaseCoeff;
      this.reduction = target + coeff * (this.reduction - target);
      if (this.reduction > maxReduction) maxReduction = this.reduction;
      const gain = dbToLin(-this.reduction) * this.makeup;
      for (let c = 0; c < channels; c += 1) {
        const line = this.delay[c];
        const old = line[this.delayPos];
        line[this.delayPos] = inputs[c][i];
        outputs[c][i] = (this.latency === 0 ? inputs[c][i] : old) * gain;
      }
      this.delayPos = (this.delayPos + 1) % size;
    }
    this.meter = maxReduction;
  }

  reset(): void {
    this.delay = [];
    this.delayPos = 0;
    this.reduction = 0;
    this.meter = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Factory + offline helper                                             */
/* ------------------------------------------------------------------ */

export const REPAIR_EFFECT_TYPES: readonly RepairEffectType[] = [
  "deHum",
  "deClick",
  "deClip",
  "deEss",
  "deReverb",
  "gate",
  "brickwallLimiter",
  "lowPass",
];

export const isRepairEffectType = (value: unknown): value is RepairEffectType =>
  typeof value === "string" && (REPAIR_EFFECT_TYPES as readonly string[]).includes(value);

/** Processor kinds the worklet runs that are not user-facing repair effects. */
export type DspProcessorType = RepairEffectType | "linkedCompressor";

export const isDspProcessorType = (value: unknown): value is DspProcessorType =>
  value === "linkedCompressor" || isRepairEffectType(value);

export function createRepairProcessor(
  type: DspProcessorType,
  sampleRate: number,
  params: RepairParams = {},
): RepairProcessor {
  switch (type) {
    case "deHum":
      return new DeHumProcessor(sampleRate, params);
    case "deClick":
      return new DeClickProcessor(sampleRate, params);
    case "deClip":
      return new DeClipProcessor(sampleRate, params);
    case "deEss":
      return new DeEssProcessor(sampleRate, params);
    case "deReverb":
      return new DeReverbProcessor(sampleRate, params);
    case "gate":
      return new GateProcessor(sampleRate, params);
    case "brickwallLimiter":
      return new BrickwallLimiterProcessor(sampleRate, params);
    case "lowPass":
      return new LowPassProcessor(sampleRate, params);
    case "linkedCompressor":
      return new LinkedCompressorProcessor(sampleRate, params);
  }
}

/**
 * Runs a processor over whole channels in `blockSize` steps and returns the
 * output with its latency removed (same length as the input). This is the
 * reference the realtime worklet is checked against: block size must not
 * change the result.
 */
export function processChannels(
  type: DspProcessorType,
  channels: Float32Array[],
  sampleRate: number,
  params: RepairParams = {},
  blockSize = 128,
): Float32Array[] {
  const proc = createRepairProcessor(type, sampleRate, params);
  const length = channels[0]?.length ?? 0;
  const total = length + proc.latency;
  const out = channels.map(() => new Float32Array(total));
  const padded = channels.map((c) => {
    const p = new Float32Array(total);
    p.set(c);
    return p;
  });
  for (let at = 0; at < total; at += blockSize) {
    const n = Math.min(blockSize, total - at);
    proc.process(
      padded.map((c) => c.subarray(at, at + n)),
      out.map((c) => c.subarray(at, at + n)),
      n,
    );
  }
  return out.map((c) => c.slice(proc.latency, proc.latency + length));
}

/** Latency (samples) a processor of this type adds with the given params. */
export function repairLatencySamples(type: RepairEffectType, sampleRate: number, params: RepairParams = {}): number {
  return createRepairProcessor(type, sampleRate, params).latency;
}
