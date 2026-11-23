/**
 * Complex FFT for any size whose prime factors are small (the speech-enhancement STFT uses 960 = 2^6 * 3 * 5).
 * Recursive decimation in time with precomputed twiddles; Float64 throughout so the framing stays exact.
 */
export class MixedRadixFFT {
  readonly size: number;
  private readonly factors: number[];
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly scratchRe: Float64Array;
  private readonly scratchIm: Float64Array;
  private readonly negIm: Float64Array;

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 1) throw new Error("FFT size must be a positive integer");
    this.size = size;
    this.factors = [];
    let rest = size;
    for (const p of [4, 2, 3, 5]) {
      while (rest % p === 0) {
        this.factors.push(p);
        rest /= p;
      }
    }
    for (let p = 7; rest > 1; p += 2) {
      while (rest % p === 0) {
        this.factors.push(p);
        rest /= p;
      }
    }
    this.cos = new Float64Array(size);
    this.sin = new Float64Array(size);
    for (let i = 0; i < size; i += 1) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
    this.scratchRe = new Float64Array(size);
    this.scratchIm = new Float64Array(size);
    this.negIm = new Float64Array(size);
  }

  /** Forward transform (e^-i), unnormalised: out[k] = sum x[n] e^{-2 pi i n k / N}. */
  forward(inRe: Float64Array, inIm: Float64Array, outRe: Float64Array, outIm: Float64Array): void {
    this.rec(inRe, inIm, 0, 1, outRe, outIm, 0, this.size, 0);
  }

  /** Inverse transform (e^+i), unnormalised (divide by N yourself). */
  inverse(inRe: Float64Array, inIm: Float64Array, outRe: Float64Array, outIm: Float64Array): void {
    // conj(FFT(conj(x))) = unnormalised inverse
    const n = this.size;
    const negIm = this.negIm;
    for (let i = 0; i < n; i += 1) negIm[i] = -inIm[i];
    this.rec(inRe, negIm, 0, 1, outRe, outIm, 0, n, 0);
    for (let i = 0; i < n; i += 1) outIm[i] = -outIm[i];
  }

  private rec(
    inRe: Float64Array,
    inIm: Float64Array,
    inOff: number,
    stride: number,
    outRe: Float64Array,
    outIm: Float64Array,
    outOff: number,
    n: number,
    level: number,
  ): void {
    if (n === 1) {
      outRe[outOff] = inRe[inOff];
      outIm[outOff] = inIm[inOff];
      return;
    }
    const p = this.factors[level];
    const m = n / p;
    for (let q = 0; q < p; q += 1) {
      this.rec(inRe, inIm, inOff + q * stride, stride * p, outRe, outIm, outOff + q * m, m, level + 1);
    }
    const twStep = this.size / n;
    const sRe = this.scratchRe;
    const sIm = this.scratchIm;
    const pStep = this.size / p;
    for (let k = 0; k < m; k += 1) {
      for (let q = 0; q < p; q += 1) {
        const idx = outOff + q * m + k;
        const t = (q * k * twStep) % this.size;
        const c = this.cos[t];
        const s = this.sin[t];
        sRe[q] = outRe[idx] * c - outIm[idx] * s;
        sIm[q] = outRe[idx] * s + outIm[idx] * c;
      }
      for (let r = 0; r < p; r += 1) {
        let accRe = 0;
        let accIm = 0;
        for (let q = 0; q < p; q += 1) {
          const t = (((q * r) % p) * pStep) % this.size;
          accRe += sRe[q] * this.cos[t] - sIm[q] * this.sin[t];
          accIm += sRe[q] * this.sin[t] + sIm[q] * this.cos[t];
        }
        outRe[outOff + r * m + k] = accRe;
        outIm[outOff + r * m + k] = accIm;
      }
    }
  }
}
