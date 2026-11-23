import { describe, expect, it } from "vitest";
import { limitPeaks, peakOfChannels } from "./reverb-limiter";

const SR = 16000;

describe("limitPeaks", () => {
  it("leaves a signal within the limit untouched, bit for bit", () => {
    const x = Float32Array.from({ length: 4000 }, (_, i) => 0.5 * Math.sin(i / 7));
    const copy = x.slice();
    expect(limitPeaks([x], 0.5, SR)).toBe(1);
    expect(Buffer.from(x.buffer).equals(Buffer.from(copy.buffer))).toBe(true);
  });

  it("brings every sample within the limit by smooth gain, the same on all channels", () => {
    const length = 8000;
    const a = Float32Array.from({ length }, (_, i) => 0.6 * Math.sin(i / 5));
    const b = a.map((v) => v * 0.5);
    a[3000] = 1.4;
    a[3001] = -1.42;
    const original = [a.slice(), b.slice()];
    const strongest = limitPeaks([a, b], 1, SR);
    expect(peakOfChannels([a, b])).toBeLessThanOrEqual(1 + 1e-6);
    expect(strongest).toBeLessThan(0.75);
    // linked gain: the ratio between channels is preserved wherever the signal is non-trivial
    for (let i = 0; i < length; i += 1) if (Math.abs(original[0][i]) > 0.1) expect(b[i] / a[i]).toBeCloseTo(original[1][i] / original[0][i], 4);
    // no step: the gain changes by a few percent per sample at most, far from a clip
    let maxStep = 0;
    let previous = 1;
    for (let i = 0; i < length; i += 1) {
      if (Math.abs(original[0][i]) < 0.2) continue;
      const gain = a[i] / original[0][i];
      maxStep = Math.max(maxStep, Math.abs(gain - previous));
      previous = gain;
    }
    expect(maxStep).toBeLessThan(0.05);
    // far from the overshoot the signal is unchanged
    expect(a[100]).toBe(original[0][100]);
    expect(a[7900]).toBe(original[0][7900]);
  });

  it("handles short signals and a signal that is over the limit everywhere", () => {
    const short = Float32Array.of(2, -2, 2);
    limitPeaks([short], 1, SR);
    expect(peakOfChannels([short])).toBeLessThanOrEqual(1 + 1e-6);
    const loud = Float32Array.from({ length: 3000 }, (_, i) => 3 * Math.sin(i / 9));
    limitPeaks([loud], 1, SR);
    expect(peakOfChannels([loud])).toBeLessThanOrEqual(1 + 1e-6);
  });
});
