/**
 * Sample-streaming DSP for the creative / utility effects. Plain TypeScript with no Web Audio dependency: the SAME
 * classes run inside the AudioWorklet (live preview, track/bus racks, clip chains and the offline export render all
 * load one worklet), and the unit tests drive them directly, so "preview == export" holds by construction. Block size
 * never changes the result. All effects are zero-latency.
 */
import {
  CREATIVE_FX_DEFINITIONS,
  isDiscreteCreativeParam,
  sanitizeCreativeParams,
  type CreativeFxType,
  type CreativeParamSpec,
} from "./creative-fx-definitions";

export type CreativeParams = Readonly<Record<string, number | string | boolean>>;

export interface CreativeProcessor {
  /** Apply params by key (clamped). */
  setParams(params: CreativeParams): void;
  /** Apply the ordered slot values the worklet's AudioParams carry (clamped). */
  setValues(values: ArrayLike<number>): void;
  /**
   * Timeline clock: at the next sample, context time is `contextSeconds` and timeline time is `contextSeconds + offset`.
   * Modulated effects (chorus, flanger, phaser) re-anchor their LFO phase to the timeline when `offset` changes (a play
   * or seek) and free-run otherwise, so a render that starts earlier or later hears the same modulation.
   */
  setClock(contextSeconds: number, offset: number): void;
  /** Process `frames` samples; inputs/outputs hold one Float32Array per channel. */
  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void;
  reset(): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dbToLin = (db: number) => Math.pow(10, db / 20);
const TWO_PI = Math.PI * 2;
/** Continuous params glide to a new value over roughly this long, so edits and automation never click. */
const SMOOTH_SECONDS = 0.01;
/** A change of the clock offset below this (seconds) is rounding noise, not a seek. */
const CLOCK_TOLERANCE = 1e-3;

abstract class BaseProcessor implements CreativeProcessor {
  protected readonly specs: readonly CreativeParamSpec[];
  protected readonly smoothed: readonly boolean[];
  /** Current (smoothed) values, in definition order. */
  protected readonly v: number[];
  protected readonly target: number[];
  private readonly coeff: number;

  constructor(
    protected readonly type: CreativeFxType,
    protected readonly sampleRate: number,
    params: CreativeParams,
  ) {
    this.specs = CREATIVE_FX_DEFINITIONS[type].params;
    this.smoothed = this.specs.map((s) => !isDiscreteCreativeParam(s));
    const clean = sanitizeCreativeParams(type, params as Record<string, unknown>);
    this.target = this.specs.map((s) => clean[s.key]);
    this.v = [...this.target];
    this.coeff = 1 - Math.exp(-1 / (SMOOTH_SECONDS * sampleRate));
  }

  setParams(params: CreativeParams): void {
    const clean = sanitizeCreativeParams(this.type, params as Record<string, unknown>);
    this.setValues(this.specs.map((s) => clean[s.key]));
  }

  setValues(values: ArrayLike<number>): void {
    for (let i = 0; i < this.specs.length; i += 1) {
      const raw = values[i];
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const spec = this.specs[i];
      const value = clamp(raw, spec.min, spec.max);
      this.target[i] = this.smoothed[i] ? value : Math.round(value);
      if (!this.smoothed[i]) this.v[i] = this.target[i];
    }
  }

  private anchoredOffset: number | null = null;

  setClock(contextSeconds: number, offset: number): void {
    if (!Number.isFinite(contextSeconds) || !Number.isFinite(offset)) return;
    if (this.anchoredOffset !== null && Math.abs(offset - this.anchoredOffset) <= CLOCK_TOLERANCE) return;
    this.anchoredOffset = offset;
    this.anchorPhase(contextSeconds + offset);
  }

  /** Called when the clock re-anchors: modulated effects place their LFO at `timelineSeconds`. */
  protected anchorPhase(timelineSeconds: number): void {
    void timelineSeconds;
  }

  protected resetClock(): void {
    this.anchoredOffset = null;
  }

  protected advance(): void {
    for (let i = 0; i < this.v.length; i += 1) {
      if (this.smoothed[i]) this.v[i] += (this.target[i] - this.v[i]) * this.coeff;
    }
  }

  abstract process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void;
  abstract reset(): void;
}

/** Input channel `c`, falling back to channel 0 (mono into a stereo node) and silence. */
const channelIn = (inputs: Float32Array[], c: number, silent: Float32Array): Float32Array => inputs[c] ?? inputs[0] ?? silent;

/** A non-finite input sample (an upstream bug) becomes silence so it can never poison feedback / filter state. */
const finite = (x: number): number => (Number.isFinite(x) ? x : 0);

let zeroBuffer = new Float32Array(128);
/** A shared silent buffer of at least `frames` samples (read-only). */
const silence = (frames: number): Float32Array => {
  if (zeroBuffer.length < frames) zeroBuffer = new Float32Array(frames);
  return zeroBuffer;
};

/* ------------------------------------------------------------------ */
/* Chorus / Flanger: one modulated, feedback delay line per channel     */
/* ------------------------------------------------------------------ */

const MAX_DELAY_SECONDS = 0.06;
const STATE_LIMIT = 4;

export class ModulatedDelayProcessor extends BaseProcessor {
  private lines: Float32Array[] = [];
  private readonly size: number;
  private pos = 0;
  private phase = 0;
  private silent = new Float32Array(0);

  constructor(type: "chorus" | "flanger", sampleRate: number, params: CreativeParams = {}) {
    super(type, sampleRate, params);
    this.size = Math.ceil(sampleRate * MAX_DELAY_SECONDS) + 8;
  }

  protected override anchorPhase(timelineSeconds: number): void {
    const cycles = timelineSeconds * this.v[0];
    this.phase = cycles - Math.floor(cycles);
  }

  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    const channels = outputs.length;
    while (this.lines.length < channels) this.lines.push(new Float32Array(this.size));
    if (this.silent.length < frames) this.silent = new Float32Array(frames);
    const size = this.size;
    for (let i = 0; i < frames; i += 1) {
      this.advance();
      const [rate, depth, delayMs, feedback, spread, mix] = this.v;
      this.phase += rate / this.sampleRate;
      if (this.phase >= 1) this.phase -= 1;
      const baseSamples = (delayMs / 1000) * this.sampleRate;
      for (let c = 0; c < channels; c += 1) {
        const x = finite(channelIn(inputs, c, this.silent)[i] ?? 0);
        const line = this.lines[c];
        const lfo = Math.sin(TWO_PI * (this.phase + (c % 2 === 1 ? spread * 0.5 : 0)));
        const delay = clamp(baseSamples * (1 + 0.8 * depth * lfo), 1, size - 3);
        let read = this.pos - delay;
        if (read < 0) read += size;
        const i0 = Math.floor(read);
        const frac = read - i0;
        const a = line[i0];
        const b = line[i0 + 1 >= size ? 0 : i0 + 1];
        const wet = a + (b - a) * frac;
        line[this.pos] = clamp(x + feedback * wet, -STATE_LIMIT, STATE_LIMIT);
        outputs[c][i] = x * (1 - mix) + wet * mix;
      }
      this.pos = this.pos + 1 >= size ? 0 : this.pos + 1;
    }
  }

  reset(): void {
    this.lines = [];
    this.pos = 0;
    this.phase = 0;
    this.resetClock();
  }
}

/* ------------------------------------------------------------------ */
/* Phaser: swept first-order all-pass chain                              */
/* ------------------------------------------------------------------ */

const MAX_STAGES = 12;

export class PhaserProcessor extends BaseProcessor {
  private z: Float32Array[] = [];
  private last: Float32Array = new Float32Array(0);
  private phase = 0;
  private silent = new Float32Array(0);

  constructor(sampleRate: number, params: CreativeParams = {}) {
    super("phaser", sampleRate, params);
  }

  /** First-order all-pass coefficient for a corner frequency (phase is -90 degrees there). */
  static coefficient(sampleRate: number, frequency: number): number {
    const t = Math.tan((Math.PI * clamp(frequency, 10, sampleRate * 0.45)) / sampleRate);
    return (t - 1) / (t + 1);
  }

  protected override anchorPhase(timelineSeconds: number): void {
    const cycles = timelineSeconds * this.v[0];
    this.phase = cycles - Math.floor(cycles);
  }

  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    const channels = outputs.length;
    while (this.z.length < channels) this.z.push(new Float32Array(MAX_STAGES));
    if (this.last.length < channels) {
      const next = new Float32Array(channels);
      next.set(this.last);
      this.last = next;
    }
    if (this.silent.length < frames) this.silent = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      this.advance();
      const [rate, depth, centre, feedback, stagesRaw, mix] = this.v;
      const stages = clamp(Math.round(stagesRaw), 2, MAX_STAGES);
      this.phase += rate / this.sampleRate;
      if (this.phase >= 1) this.phase -= 1;
      const lfo = Math.sin(TWO_PI * this.phase);
      // +-2 octaves around the centre at full depth.
      const a = PhaserProcessor.coefficient(this.sampleRate, centre * Math.pow(2, 2 * depth * lfo));
      for (let c = 0; c < channels; c += 1) {
        const x = finite(channelIn(inputs, c, this.silent)[i] ?? 0);
        const z = this.z[c];
        let s = clamp(x + feedback * this.last[c], -STATE_LIMIT, STATE_LIMIT);
        for (let k = 0; k < stages; k += 1) {
          const y = a * s + z[k];
          z[k] = s - a * y;
          s = y;
        }
        this.last[c] = s;
        outputs[c][i] = x * (1 - mix) + s * mix;
      }
    }
  }

  reset(): void {
    this.z = [];
    this.last = new Float32Array(0);
    this.phase = 0;
    this.resetClock();
  }
}

/* ------------------------------------------------------------------ */
/* Distortion                                                            */
/* ------------------------------------------------------------------ */

/** Waveshaper curves: 0 soft (tanh, odd harmonics), 1 hard clip, 2 tube (asymmetric, adds even harmonics). */
export function shapeSample(mode: number, x: number): number {
  if (mode === 1) return x > 1 ? 1 : x < -1 ? -1 : x;
  if (mode === 2) return x >= 0 ? 1 - Math.exp(-x) : -0.8 * (1 - Math.exp(1.25 * x));
  return Math.tanh(x);
}

export class DistortionProcessor extends BaseProcessor {
  private lowpass = new Float32Array(0);
  private dcIn = new Float32Array(0);
  private dcOut = new Float32Array(0);
  private silent = new Float32Array(0);
  private readonly dcCoeff: number;

  constructor(sampleRate: number, params: CreativeParams = {}) {
    super("distortion", sampleRate, params);
    this.dcCoeff = 1 - (TWO_PI * 10) / sampleRate;
  }

  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    const channels = outputs.length;
    if (this.lowpass.length < channels) {
      this.lowpass = new Float32Array(channels);
      this.dcIn = new Float32Array(channels);
      this.dcOut = new Float32Array(channels);
    }
    if (this.silent.length < frames) this.silent = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      this.advance();
      const mode = this.v[0];
      const drive = dbToLin(this.v[1]);
      const alpha = 1 - Math.exp((-TWO_PI * this.v[2]) / this.sampleRate);
      const level = dbToLin(this.v[3]);
      const mix = this.v[4];
      for (let c = 0; c < channels; c += 1) {
        const x = finite(channelIn(inputs, c, this.silent)[i] ?? 0);
        let shaped = shapeSample(mode, x * drive);
        if (mode === 2) {
          // The asymmetric curve moves the DC offset; a 10 Hz high-pass takes it out again.
          const y = shaped - this.dcIn[c] + this.dcCoeff * this.dcOut[c];
          this.dcIn[c] = shaped;
          this.dcOut[c] = y;
          shaped = y;
        }
        this.lowpass[c] += alpha * (shaped - this.lowpass[c]);
        outputs[c][i] = x * (1 - mix) + this.lowpass[c] * level * mix;
      }
    }
  }

  reset(): void {
    this.lowpass = new Float32Array(0);
    this.dcIn = new Float32Array(0);
    this.dcOut = new Float32Array(0);
  }
}

/* ------------------------------------------------------------------ */
/* Stereo Width (mid/side), Invert Polarity, Channel Swap / Mono         */
/* ------------------------------------------------------------------ */

export class StereoWidthProcessor extends BaseProcessor {
  constructor(sampleRate: number, params: CreativeParams = {}) {
    super("stereoWidth", sampleRate, params);
  }

  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    const channels = outputs.length;
    for (let c = 2; c < channels; c += 1) outputs[c].set(channelIn(inputs, c, silence(frames)).subarray(0, frames));
    const lIn = channelIn(inputs, 0, silence(frames));
    const rIn = channelIn(inputs, 1, silence(frames));
    for (let i = 0; i < frames; i += 1) {
      this.advance();
      const width = this.v[0];
      const mid = dbToLin(this.v[1]);
      if (channels < 2) {
        outputs[0][i] = (lIn[i] ?? 0) * mid;
        continue;
      }
      const l = lIn[i] ?? 0;
      const r = rIn[i] ?? 0;
      const m = ((l + r) / 2) * mid;
      const s = ((l - r) / 2) * width;
      outputs[0][i] = m + s;
      outputs[1][i] = m - s;
    }
  }

  reset(): void {
    /* stateless */
  }
}

export class InvertPolarityProcessor extends BaseProcessor {
  constructor(sampleRate: number, params: CreativeParams = {}) {
    super("invertPolarity", sampleRate, params);
  }

  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    const left = this.v[0] >= 0.5;
    const right = this.v[1] >= 0.5;
    for (let c = 0; c < outputs.length; c += 1) {
      // Channel 0 follows Left, channel 1 follows Right; further channels (5.1) flip when both are on.
      const flip = c === 0 ? left : c === 1 ? right : left && right;
      const source = channelIn(inputs, c, silence(frames));
      const out = outputs[c];
      if (flip) for (let i = 0; i < frames; i += 1) out[i] = -source[i];
      else for (let i = 0; i < frames; i += 1) out[i] = source[i];
    }
  }

  reset(): void {
    /* stateless */
  }
}

export class ChannelMapProcessor extends BaseProcessor {
  constructor(sampleRate: number, params: CreativeParams = {}) {
    super("channelMap", sampleRate, params);
  }

  process(inputs: Float32Array[], outputs: Float32Array[], frames: number): void {
    const mode = this.v[0];
    const channels = outputs.length;
    for (let c = 2; c < channels; c += 1) outputs[c].set(channelIn(inputs, c, silence(frames)).subarray(0, frames));
    if (channels < 2) {
      outputs[0].set(channelIn(inputs, 0, silence(frames)).subarray(0, frames));
      return;
    }
    const lIn = channelIn(inputs, 0, silence(frames));
    const rIn = channelIn(inputs, 1, silence(frames));
    for (let i = 0; i < frames; i += 1) {
      const l = lIn[i] ?? 0;
      const r = rIn[i] ?? 0;
      switch (mode) {
        case 1:
          outputs[0][i] = r;
          outputs[1][i] = l;
          break;
        case 2: {
          const m = (l + r) / 2;
          outputs[0][i] = m;
          outputs[1][i] = m;
          break;
        }
        case 3:
          outputs[0][i] = l;
          outputs[1][i] = l;
          break;
        case 4:
          outputs[0][i] = r;
          outputs[1][i] = r;
          break;
        default:
          outputs[0][i] = l;
          outputs[1][i] = r;
      }
    }
  }

  reset(): void {
    /* stateless */
  }
}

/* ------------------------------------------------------------------ */
/* Factory + offline helper                                              */
/* ------------------------------------------------------------------ */

export function createCreativeProcessor(type: CreativeFxType, sampleRate: number, params: CreativeParams = {}): CreativeProcessor {
  switch (type) {
    case "chorus":
    case "flanger":
      return new ModulatedDelayProcessor(type, sampleRate, params);
    case "phaser":
      return new PhaserProcessor(sampleRate, params);
    case "distortion":
      return new DistortionProcessor(sampleRate, params);
    case "stereoWidth":
      return new StereoWidthProcessor(sampleRate, params);
    case "invertPolarity":
      return new InvertPolarityProcessor(sampleRate, params);
    case "channelMap":
      return new ChannelMapProcessor(sampleRate, params);
  }
}

/**
 * Runs a processor over whole channels in `blockSize` steps (the reference an offline render is checked against:
 * block size must not change the result). Output has the input's length; the effects add no latency.
 */
export function renderCreativeFx(
  type: CreativeFxType,
  channels: Float32Array[],
  sampleRate: number,
  params: CreativeParams = {},
  blockSize = 128,
  /** Timeline time (seconds) of the first sample: the LFO phase of modulated effects follows the timeline. */
  timelineStart = 0,
): Float32Array[] {
  const proc = createCreativeProcessor(type, sampleRate, params);
  const length = channels[0]?.length ?? 0;
  const out = channels.map(() => new Float32Array(length));
  for (let at = 0; at < length; at += blockSize) {
    const n = Math.min(blockSize, length - at);
    proc.setClock(at / sampleRate, timelineStart);
    proc.process(
      channels.map((c) => c.subarray(at, at + n)),
      out.map((c) => c.subarray(at, at + n)),
      n,
    );
  }
  return out;
}
