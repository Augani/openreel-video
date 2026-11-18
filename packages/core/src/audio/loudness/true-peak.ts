/**
 * True-peak detection per ITU-R BS.1770-4 Annex 2: the signal is oversampled
 * 4x with a polyphase FIR interpolator and the largest absolute oversampled
 * sample is reported (dBTP). The interpolator is a Kaiser-windowed sinc with
 * the cut-off at the original Nyquist.
 */

export const TRUE_PEAK_OVERSAMPLING = 4;
const TAPS_PER_PHASE = 16;
const KAISER_BETA = 9;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 60; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** PHASES[p][t] multiplies the input sample t steps back from the newest. */
function buildPolyphase(): Float64Array[] {
  const L = TRUE_PEAK_OVERSAMPLING;
  const total = L * TAPS_PER_PHASE;
  const center = (total - 1) / 2;
  const denom = besselI0(KAISER_BETA);
  const h = new Float64Array(total);
  for (let n = 0; n < total; n++) {
    const t = (n - center) / L;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const r = (2 * n) / (total - 1) - 1;
    h[n] = sinc * (besselI0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - r * r))) / denom);
  }
  const phases: Float64Array[] = [];
  for (let p = 0; p < L; p++) {
    const phase = new Float64Array(TAPS_PER_PHASE);
    let sum = 0;
    for (let t = 0; t < TAPS_PER_PHASE; t++) {
      phase[t] = h[t * L + p];
      sum += phase[t];
    }
    // Unity DC gain per phase keeps flat signals exactly flat.
    for (let t = 0; t < TAPS_PER_PHASE; t++) phase[t] /= sum;
    phases.push(phase);
  }
  return phases;
}

const PHASES = buildPolyphase();

/** Streaming 4x interpolator for one channel. */
export class TruePeakInterpolator {
  private readonly history = new Float64Array(TAPS_PER_PHASE * 2);
  private pos = 0;

  /**
   * Push one input sample; returns the max absolute value over the 4
   * oversampled points produced for this input.
   */
  push(x: number): number {
    const hist = this.history;
    hist[this.pos] = x;
    hist[this.pos + TAPS_PER_PHASE] = x;
    this.pos = (this.pos + 1) % TAPS_PER_PHASE;
    const newest = this.pos + TAPS_PER_PHASE - 1;
    let peak = 0;
    for (let p = 0; p < TRUE_PEAK_OVERSAMPLING; p++) {
      const coeffs = PHASES[p];
      let acc = 0;
      for (let t = 0; t < TAPS_PER_PHASE; t++) acc += coeffs[t] * hist[newest - t];
      const a = Math.abs(acc);
      if (a > peak) peak = a;
    }
    return peak;
  }

  reset(): void {
    this.history.fill(0);
    this.pos = 0;
  }
}

/** Multi-channel streaming true-peak meter. */
export class TruePeakMeter {
  private readonly interpolators: TruePeakInterpolator[];
  private peak = 0;
  private samplePeak = 0;

  constructor(channels: number) {
    this.interpolators = Array.from({ length: channels }, () => new TruePeakInterpolator());
  }

  process(channels: ArrayLike<number>[], length = channels[0]?.length ?? 0): void {
    for (let c = 0; c < this.interpolators.length; c++) {
      const data = channels[c];
      if (!data) continue;
      const interp = this.interpolators[c];
      for (let i = 0; i < length; i++) {
        const x = data[i];
        const a = Math.abs(x);
        if (a > this.samplePeak) this.samplePeak = a;
        const tp = interp.push(x);
        if (tp > this.peak) this.peak = tp;
      }
    }
  }

  /** Linear true peak so far (max over channels). */
  get linear(): number {
    return Math.max(this.peak, this.samplePeak);
  }

  get samplePeakLinear(): number {
    return this.samplePeak;
  }

  reset(): void {
    this.interpolators.forEach((i) => i.reset());
    this.peak = 0;
    this.samplePeak = 0;
  }
}

export function linearToDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}
