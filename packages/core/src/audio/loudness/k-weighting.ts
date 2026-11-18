/**
 * ITU-R BS.1770-4 K-weighting.
 *
 * Stage 1 is a high-shelf "head" filter (+4 dB above ~1.7 kHz) and stage 2 is a
 * second-order high-pass (RLB weighting, ~38 Hz). The published coefficients
 * are only valid at 48 kHz, so, like EBU Tech 3341 reference implementations
 * (libebur128), the analogue prototype parameters are re-derived through the
 * bilinear transform for any sample rate. At 48 kHz this reproduces the
 * coefficients tabulated in BS.1770-4 Annex 1.
 */

export interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** Prototype parameters of the two K-weighting stages. */
export const K_SHELF = {
  frequency: 1681.974450955533,
  gainDb: 3.999843853973347,
  q: 0.7071752369554196,
} as const;
export const K_HIGHPASS = {
  frequency: 38.13547087602444,
  q: 0.5003270373238773,
} as const;

export function kShelfCoefficients(sampleRate: number): BiquadCoefficients {
  const k = Math.tan((Math.PI * K_SHELF.frequency) / sampleRate);
  const vh = Math.pow(10, K_SHELF.gainDb / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0 = 1 + k / K_SHELF.q + k * k;
  return {
    b0: (vh + (vb * k) / K_SHELF.q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / K_SHELF.q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / K_SHELF.q + k * k) / a0,
  };
}

export function kHighPassCoefficients(sampleRate: number): BiquadCoefficients {
  const k = Math.tan((Math.PI * K_HIGHPASS.frequency) / sampleRate);
  const a0 = 1 + k / K_HIGHPASS.q + k * k;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / K_HIGHPASS.q + k * k) / a0,
  };
}

/** Direct form I biquad with double-precision state. */
export class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(private readonly c: BiquadCoefficients) {}

  process(x: number): number {
    const c = this.c;
    const y = c.b0 * x + c.b1 * this.x1 + c.b2 * this.x2 - c.a1 * this.y1 - c.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/** The two cascaded K-weighting stages for one channel. */
export class KWeightingFilter {
  private readonly shelf: Biquad;
  private readonly highPass: Biquad;

  constructor(sampleRate: number) {
    this.shelf = new Biquad(kShelfCoefficients(sampleRate));
    this.highPass = new Biquad(kHighPassCoefficients(sampleRate));
  }

  process(x: number): number {
    return this.highPass.process(this.shelf.process(x));
  }

  reset(): void {
    this.shelf.reset();
    this.highPass.reset();
  }
}

/** Magnitude (dB) of the cascaded K-weighting filter at `frequency`. */
export function kWeightingMagnitudeDb(frequency: number, sampleRate: number): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const mag = (c: BiquadCoefficients): number => {
    const cos1 = Math.cos(w);
    const sin1 = Math.sin(w);
    const cos2 = Math.cos(2 * w);
    const sin2 = Math.sin(2 * w);
    const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
    const ni = -(c.b1 * sin1 + c.b2 * sin2);
    const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
    const di = -(c.a1 * sin1 + c.a2 * sin2);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  };
  return 20 * Math.log10(mag(kShelfCoefficients(sampleRate)) * mag(kHighPassCoefficients(sampleRate)));
}
