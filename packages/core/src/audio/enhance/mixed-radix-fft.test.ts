import { describe, expect, it } from "vitest";
import { MixedRadixFFT } from "./mixed-radix-fft";

const naive = (re: Float64Array, im: Float64Array, sign: number) => {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    for (let t = 0; t < n; t += 1) {
      const a = (sign * 2 * Math.PI * ((k * t) % n)) / n;
      outRe[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a);
      outIm[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
  }
  return { re: outRe, im: outIm };
};

const rand = (n: number, seed: number) => {
  let s = seed;
  return Float64Array.from({ length: n }, () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5);
};

describe("MixedRadixFFT", () => {
  for (const n of [1, 2, 7, 12, 30, 64, 480, 960]) {
    it(`matches the direct DFT at size ${n} (forward and inverse)`, () => {
      const fft = new MixedRadixFFT(n);
      const re = rand(n, n);
      const im = rand(n, n + 1);
      const outRe = new Float64Array(n);
      const outIm = new Float64Array(n);
      fft.forward(re, im, outRe, outIm);
      const ref = naive(re, im, -1);
      for (let k = 0; k < n; k += 1) {
        expect(Math.abs(outRe[k] - ref.re[k])).toBeLessThan(1e-9);
        expect(Math.abs(outIm[k] - ref.im[k])).toBeLessThan(1e-9);
      }
      const backRe = new Float64Array(n);
      const backIm = new Float64Array(n);
      fft.inverse(outRe, outIm, backRe, backIm);
      for (let i = 0; i < n; i += 1) {
        expect(Math.abs(backRe[i] / n - re[i])).toBeLessThan(1e-9);
        expect(Math.abs(backIm[i] / n - im[i])).toBeLessThan(1e-9);
      }
    });
  }

  it("rejects invalid sizes", () => {
    expect(() => new MixedRadixFFT(0)).toThrow();
    expect(() => new MixedRadixFFT(2.5)).toThrow();
  });
});
