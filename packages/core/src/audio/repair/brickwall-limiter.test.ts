import { describe, expect, it } from "vitest";
import { TruePeakMeter } from "../loudness/true-peak";
import { brickwallLookaheadSamples, butterworthQs, createRepairProcessor, processChannels, repairLatencySamples } from "./repair-dsp";
import { sanitizeRepairParams } from "./repair-definitions";

const SR = 48000;
const rng = (seed: number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const make = (n: number, f: (i: number) => number) => Float32Array.from({ length: n }, (_, i) => f(i));
const dbOf = (lin: number) => 20 * Math.log10(lin);

/** Independent 16x windowed-sinc true-peak reference (not the limiter's own 4x detector). */
function referenceTruePeak(x: Float32Array): number {
  const L = 16;
  const half = 24;
  let peak = 0;
  for (let i = half; i < x.length - half; i += 1) {
    for (let p = 0; p < L; p += 1) {
      const frac = p / L;
      let acc = 0;
      for (let k = -half + 1; k <= half; k += 1) {
        const t = k - frac;
        const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
        const win = 0.5 + 0.5 * Math.cos((Math.PI * t) / (half + 1));
        acc += x[i + k] * sinc * win;
      }
      if (Math.abs(acc) > peak) peak = Math.abs(acc);
    }
  }
  return peak;
}

/** Hot program: sine bursts at awkward phases (inter-sample peaks), noise and a full-scale click train. */
function hotSignal(channel: number, seconds = 2): Float32Array {
  const rand = rng(1234 + channel);
  const n = SR * seconds;
  return make(n, (i) => {
    const t = i / SR;
    // fs/4 with a 45 degree phase puts the sample peak 3 dB under the true peak.
    const intersample = 1.9 * Math.sin((2 * Math.PI * (SR / 4) * i) / SR + Math.PI / 4 + channel);
    const burst = t % 0.5 < 0.2 ? intersample : 0;
    const noise = (rand() * 2 - 1) * 0.6 * (t > 1 ? 1 : 0.1);
    const click = i % 7919 === 0 ? 3 : 0;
    return burst + noise + 0.8 * Math.sin((2 * Math.PI * 997 * i) / SR) + click;
  });
}

describe("brickwallLimiter", () => {
  it("reports its fixed lookahead as the processor latency", () => {
    expect(repairLatencySamples("brickwallLimiter", SR)).toBe(brickwallLookaheadSamples(SR));
    expect(repairLatencySamples("brickwallLimiter", SR)).toBe(240);
    expect(repairLatencySamples("brickwallLimiter", 8000)).toBeGreaterThanOrEqual(16);
  });

  it.each([-1, -3, -6, -12])("never lets the true peak exceed a %s dBTP ceiling on a hot stereo signal", (ceiling) => {
    const input = [hotSignal(0), hotSignal(1)];
    const unlimited = new TruePeakMeter(2);
    unlimited.process(input);
    expect(dbOf(unlimited.linear)).toBeGreaterThan(ceiling + 6);

    const out = processChannels("brickwallLimiter", input, SR, { ceiling, release: 0.1 }, 128);
    const meter = new TruePeakMeter(2);
    meter.process(out);
    const limit = Math.pow(10, ceiling / 20);
    // The limiter's own measurement basis (ITU-R BS.1770 4x interpolator): never above the ceiling.
    expect(meter.linear).toBeLessThanOrEqual(limit * (1 + 1e-6));
    // An independent 16x reference also stays under the ceiling.
    for (const channel of out) expect(dbOf(referenceTruePeak(channel.subarray(SR, SR + 24000)))).toBeLessThanOrEqual(ceiling);
    // ... and it really is limiting, not muting.
    expect(dbOf(meter.linear)).toBeGreaterThan(ceiling - 1.5);
  });

  it("holds the ceiling for a full-scale square wave and a single huge impulse", () => {
    const square = make(SR, (i) => (Math.floor(i / 37) % 2 === 0 ? 4 : -4));
    const impulse = make(SR, (i) => (i === 20000 ? 50 : 0));
    for (const x of [square, impulse]) {
      const [out] = processChannels("brickwallLimiter", [x], SR, { ceiling: -2 });
      const meter = new TruePeakMeter(1);
      meter.process([out]);
      expect(meter.linear).toBeLessThanOrEqual(Math.pow(10, -2 / 20) * (1 + 1e-6));
    }
  });

  it("is transparent (pure delay, unity gain) while the signal stays under the ceiling", () => {
    const x = make(SR, (i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR));
    const proc = createRepairProcessor("brickwallLimiter", SR, { ceiling: -1 });
    const out = new Float32Array(x.length + proc.latency);
    const padded = new Float32Array(out.length);
    padded.set(x);
    proc.process([padded], [out], out.length);
    for (let i = 0; i < x.length; i += 997) expect(out[i + proc.latency]).toBeCloseTo(x[i], 6);
    expect(proc.meter).toBeCloseTo(0, 6);
  });

  it("gives the same samples whatever the block size", () => {
    const input = [hotSignal(0, 1), hotSignal(1, 1)];
    const a = processChannels("brickwallLimiter", input, SR, { ceiling: -2 }, 128);
    const b = processChannels("brickwallLimiter", input, SR, { ceiling: -2 }, 1000);
    for (let c = 0; c < 2; c += 1) for (let i = 0; i < a[c].length; i += 211) expect(b[c][i]).toBe(a[c][i]);
  });

  it("links channels: the quiet side keeps its balance when the loud side is limited", () => {
    const loud = make(SR, (i) => 2 * Math.sin((2 * Math.PI * 300 * i) / SR));
    const quiet = make(SR, (i) => 0.1 * Math.sin((2 * Math.PI * 300 * i) / SR));
    const [l, r] = processChannels("brickwallLimiter", [loud, quiet], SR, { ceiling: -6 });
    const ratio = (a: Float32Array, b: Float32Array, i: number) => a[i] / b[i];
    for (const i of [30000, 31000, 32100]) expect(ratio(l, r, i)).toBeCloseTo(ratio(loud, quiet, i), 3);
  });

  it("sanitises its params to the documented ranges", () => {
    expect(sanitizeRepairParams("brickwallLimiter", { ceiling: 5, release: 0 })).toEqual({ ceiling: 0, release: 0.01 });
  });
});

describe("lowPass", () => {
  const tone = (freq: number) => make(SR, (i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / SR));
  const rms = (x: Float32Array, from = 24000) => {
    let s = 0;
    for (let i = from; i < x.length; i += 1) s += x[i] * x[i];
    return Math.sqrt(s / (x.length - from));
  };
  const gainDb = (freq: number, params: Record<string, number>) => {
    const x = tone(freq);
    const [y] = processChannels("lowPass", [x], SR, params);
    return dbOf(rms(y) / rms(x));
  };

  it("has Butterworth Q values", () => {
    expect(butterworthQs(2)[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(butterworthQs(4)).toHaveLength(2);
  });

  it("is -3 dB at the cutoff, flat below and rolls off at the chosen slope", () => {
    expect(gainDb(500, { frequency: 4000, slope: 12 })).toBeGreaterThan(-0.1);
    expect(gainDb(4000, { frequency: 4000, slope: 12 })).toBeCloseTo(-3, 0);
    expect(gainDb(4000, { frequency: 4000, slope: 48 })).toBeCloseTo(-3, 0);
    const oct12 = gainDb(8000, { frequency: 4000, slope: 12 });
    const oct24 = gainDb(8000, { frequency: 4000, slope: 24 });
    const oct48 = gainDb(8000, { frequency: 4000, slope: 48 });
    expect(oct12).toBeLessThan(-10);
    expect(oct24).toBeLessThan(oct12 - 6);
    expect(oct48).toBeLessThan(oct24 - 15);
  });

  it("adds no latency and follows live parameter changes", () => {
    expect(repairLatencySamples("lowPass", SR)).toBe(0);
    const proc = createRepairProcessor("lowPass", SR, { frequency: 12000, slope: 12 });
    const x = tone(6000);
    const out = new Float32Array(x.length);
    proc.process([x], [out], x.length);
    const before = rms(out);
    proc.setParams({ frequency: 1000, slope: 24 });
    const out2 = new Float32Array(x.length);
    proc.process([x], [out2], x.length);
    expect(rms(out2)).toBeLessThan(before * 0.1);
  });
});
