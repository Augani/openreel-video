import { TruePeakInterpolator } from "./true-peak";

/**
 * Look-ahead true-peak limiter. Detection runs on the 4x oversampled signal
 * (the same interpolator the true-peak meter uses), the gain reduction is a
 * sliding minimum smoothed over the look-ahead window, so every oversampled
 * peak is attenuated before it arrives and the output stays under the ceiling.
 *
 * Output is delay-compensated: `process()` returns the same number of samples
 * it was given, except for the first calls, which are `lookahead` samples
 * short until `flush()` returns the tail. The total length is preserved.
 */
export class TruePeakLimiter {
  readonly lookahead: number;
  private readonly ceiling: number;
  private readonly channels: number;
  private readonly interpolators: TruePeakInterpolator[];
  private readonly delay: Float32Array[];
  private delayPos = 0;
  private skip: number;
  // Sliding minimum (monotonic deque over absolute frame indices).
  private readonly dqIndex: Float64Array;
  private readonly dqValue: Float64Array;
  private dqHead = 0;
  private dqTail = 0;
  private frame = 0;
  // Moving average of the minimum.
  private readonly avgRing: Float64Array;
  private avgSum = 0;
  private maxReduction = 1;

  constructor(sampleRate: number, channels: number, ceilingDb: number, lookaheadMs = 5) {
    this.lookahead = Math.max(1, Math.round((sampleRate * lookaheadMs) / 1000));
    this.ceiling = Math.pow(10, ceilingDb / 20);
    this.channels = channels;
    this.interpolators = Array.from({ length: channels }, () => new TruePeakInterpolator());
    this.delay = Array.from({ length: channels }, () => new Float32Array(this.lookahead));
    this.skip = this.lookahead;
    const size = this.lookahead + 2;
    this.dqIndex = new Float64Array(size);
    this.dqValue = new Float64Array(size);
    this.avgRing = new Float64Array(this.lookahead + 1).fill(1);
    this.avgSum = this.lookahead + 1;
  }

  /** Largest gain reduction applied so far, in dB (<= 0). */
  get maxGainReductionDb(): number {
    return 20 * Math.log10(this.maxReduction);
  }

  private step(inputs: ArrayLike<number>[], i: number, outputs: Float32Array[], o: number): void {
    let peak = 0;
    for (let c = 0; c < this.channels; c++) {
      const x = inputs[c]?.[i] ?? 0;
      const p = this.interpolators[c].push(x);
      if (p > peak) peak = p;
    }
    const gt = peak > this.ceiling ? this.ceiling / peak : 1;
    // Sliding minimum over the last (lookahead + 1) frames.
    const size = this.dqIndex.length;
    while (this.dqTail > this.dqHead && this.dqValue[(this.dqTail - 1) % size] >= gt) this.dqTail--;
    this.dqIndex[this.dqTail % size] = this.frame;
    this.dqValue[this.dqTail % size] = gt;
    this.dqTail++;
    while (this.dqIndex[this.dqHead % size] <= this.frame - this.lookahead - 1) this.dqHead++;
    const min = this.dqValue[this.dqHead % size];
    // Smooth with a moving average so the gain ramps rather than steps.
    const ringPos = this.frame % this.avgRing.length;
    this.avgSum += min - this.avgRing[ringPos];
    this.avgRing[ringPos] = min;
    if (this.frame % 4096 === 0) {
      let s = 0;
      for (let k = 0; k < this.avgRing.length; k++) s += this.avgRing[k];
      this.avgSum = s;
    }
    const gain = Math.min(1, this.avgSum / this.avgRing.length);
    if (gain < this.maxReduction) this.maxReduction = gain;
    this.frame++;

    for (let c = 0; c < this.channels; c++) {
      const line = this.delay[c];
      const old = line[this.delayPos];
      line[this.delayPos] = inputs[c]?.[i] ?? 0;
      if (o >= 0) outputs[c][o] = old * gain;
    }
    this.delayPos = (this.delayPos + 1) % this.lookahead;
  }

  /** Limit one chunk. Returns arrays of `length - (samples still being primed)`. */
  process(inputs: ArrayLike<number>[], length = inputs[0]?.length ?? 0): Float32Array[] {
    const emit = Math.max(0, length - this.skip);
    const outputs = Array.from({ length: this.channels }, () => new Float32Array(emit));
    let o = 0;
    for (let i = 0; i < length; i++) {
      if (this.skip > 0) {
        this.skip--;
        this.step(inputs, i, outputs, -1);
      } else {
        this.step(inputs, i, outputs, o++);
      }
    }
    return outputs;
  }

  /** Drain the look-ahead tail. Call once after the last chunk. */
  flush(): Float32Array[] {
    const silence = Array.from({ length: this.channels }, () => new Float32Array(this.lookahead));
    return this.process(silence, this.lookahead);
  }
}
