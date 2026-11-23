import { describe, expect, it } from "vitest";
import { resample, resampledLength } from "./resample";

const sine = (hz: number, rate: number, seconds: number, amp = 0.5) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i += 1) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};

describe("resample", () => {
  it("returns the input itself at the same rate and the rounded length otherwise", () => {
    const x = sine(440, 48000, 0.1);
    expect(resample(x, 48000, 48000)).toBe(x);
    expect(resampledLength(44100, 44100, 48000)).toBe(48000);
    expect(resampledLength(1, 44100, 8000)).toBe(1);
    expect(resampledLength(0, 44100, 48000)).toBe(0);
    expect(resample(x, 48000, 16000)).toHaveLength(Math.round(x.length / 3));
    expect(resample(x, 48000, 44100, 1234)).toHaveLength(1234);
    expect(resample(new Float32Array(0), 44100, 48000)).toHaveLength(0);
  });

  it("round-trips 44.1 kHz through 48 kHz with a reconstruction error under -60 dB", () => {
    const x = sine(1000, 44100, 0.5);
    const up = resample(x, 44100, 48000);
    const back = resample(up, 48000, 44100, x.length);
    const guard = 2000;
    let err = 0;
    let ref = 0;
    for (let i = guard; i < x.length - guard; i += 1) {
      err += (back[i] - x[i]) ** 2;
      ref += x[i] ** 2;
    }
    expect(10 * Math.log10(err / ref)).toBeLessThan(-60);
  });

  it("keeps the amplitude and frequency of a tone when upsampling 16 kHz -> 48 kHz", () => {
    const x = sine(2000, 16000, 0.5);
    const up = resample(x, 16000, 48000);
    expect(up).toHaveLength(x.length * 3);
    expect(rms(up, 2000, up.length - 2000)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    const ref = sine(2000, 48000, 0.5);
    let worst = 0;
    for (let i = 2000; i < up.length - 2000; i += 1) worst = Math.max(worst, Math.abs(up[i] - ref[i]));
    expect(worst).toBeLessThan(2e-3);
  });

  it("removes content above the new Nyquist when downsampling instead of aliasing it", () => {
    const x = sine(10000, 48000, 0.5);
    const down = resample(x, 48000, 16000);
    expect(rms(down, 1000, down.length - 1000)).toBeLessThan(rms(x) * 1e-3);
    const keep = resample(sine(3000, 48000, 0.5), 48000, 16000);
    expect(rms(keep, 1000, keep.length - 1000)).toBeGreaterThan(0.99 * (0.5 / Math.SQRT2));
  });
});
