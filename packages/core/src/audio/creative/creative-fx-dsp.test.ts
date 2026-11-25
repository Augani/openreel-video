import { describe, expect, it } from "vitest";
import {
  CREATIVE_FX_DEFINITIONS,
  CREATIVE_FX_MAX_PARAMS,
  CREATIVE_FX_TYPES,
  creativeFxTailSeconds,
  defaultCreativeParams,
  sanitizeCreativeParams,
} from "./creative-fx-definitions";
import { PhaserProcessor, createCreativeProcessor, renderCreativeFx, shapeSample } from "./creative-fx-dsp";

const SR = 48000;
const tone = (freq: number, amp: number, frames: number, phase = 0) =>
  Float32Array.from({ length: frames }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR + phase));
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};
/** Amplitude of one frequency over a whole number of cycles (Goertzel / single-bin DFT). */
const binAmp = (x: Float32Array, freq: number, from = 0, to = x.length) => {
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i++) {
    const a = (2 * Math.PI * freq * i) / SR;
    re += x[i] * Math.cos(a);
    im += x[i] * Math.sin(a);
  }
  return (2 * Math.hypot(re, im)) / (to - from);
};
const allFinite = (x: Float32Array) => x.every((v) => Number.isFinite(v));
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe("creative effect definitions", () => {
  it("lists every effect with unique keys, in-range defaults and no more params than the worklet has slots", () => {
    expect(CREATIVE_FX_TYPES).toEqual(["chorus", "flanger", "phaser", "distortion", "stereoWidth", "invertPolarity", "channelMap"]);
    for (const type of CREATIVE_FX_TYPES) {
      const params = CREATIVE_FX_DEFINITIONS[type].params;
      expect(params.length).toBeLessThanOrEqual(CREATIVE_FX_MAX_PARAMS);
      expect(new Set(params.map((p) => p.key)).size).toBe(params.length);
      for (const spec of params) {
        expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it("clamps, rounds switches and drops unknown or non-finite values", () => {
    const clean = sanitizeCreativeParams("distortion", { drive: 999, tone: Number.NaN, mode: 1.6, bogus: 3, mix: -1 });
    expect(clean).toEqual({ ...defaultCreativeParams("distortion"), drive: 40, mode: 2, mix: 0 });
    expect(sanitizeCreativeParams("invertPolarity", { left: true, right: false })).toEqual({ left: 1, right: 0 });
  });

  it("reports a finite tail for effects with feedback and none for the stateless ones", () => {
    expect(creativeFxTailSeconds("flanger", { feedback: 0.9, delay: 10 })).toBeGreaterThan(0.1);
    expect(creativeFxTailSeconds("chorus", { mix: 0 })).toBe(0);
    expect(creativeFxTailSeconds("invertPolarity", {})).toBe(0);
    expect(creativeFxTailSeconds("stereoWidth", {})).toBe(0);
  });
});

describe("chorus / flanger", () => {
  it("with no modulation and a fully wet mix it is an exact delay", () => {
    const x = tone(440, 0.8, SR / 2);
    const [y] = renderCreativeFx("chorus", [x], SR, { depth: 0, mix: 1, feedback: 0, delay: 10 });
    const n = Math.round(0.01 * SR);
    expect(y.slice(0, n).every((v) => v === 0)).toBe(true);
    for (let i = n; i < x.length; i++) expect(Math.abs(y[i] - x[i - n])).toBeLessThan(1e-6);
  });

  it("modulates: the level of a 1 kHz tone beats at the LFO rate, and is steady with depth 0", () => {
    const x = tone(1000, 1, SR * 2);
    const window = 480; // 10 ms
    const levels = (y: Float32Array) => {
      const out: number[] = [];
      for (let at = SR / 2; at + window <= y.length; at += window) out.push(rms(y, at, at + window));
      return out;
    };
    const [moving] = renderCreativeFx("chorus", [x], SR, { rate: 1, depth: 0.6, delay: 12, mix: 0.5, feedback: 0 });
    const [still] = renderCreativeFx("chorus", [x], SR, { rate: 1, depth: 0, delay: 12, mix: 0.5, feedback: 0 });
    const m = levels(moving);
    const s = levels(still);
    expect(Math.max(...m) / Math.min(...m)).toBeGreaterThan(1.5);
    expect(Math.max(...s) / Math.min(...s)).toBeLessThan(1.02);
  });

  it("flanger comb: a 1 ms delay at mix 0.5 cancels 500 Hz and passes 1 kHz", () => {
    const params = { depth: 0, delay: 1, feedback: 0, mix: 0.5 };
    const notch = renderCreativeFx("flanger", [tone(500, 1, SR)], SR, params)[0];
    const pass = renderCreativeFx("flanger", [tone(1000, 1, SR)], SR, params)[0];
    expect(binAmp(notch, 500, SR / 2)).toBeLessThan(0.01);
    expect(binAmp(pass, 1000, SR / 2)).toBeGreaterThan(0.99);
  });

  it("feedback keeps the output bounded and finite, including at the extremes", () => {
    const x = tone(250, 1, SR);
    for (const type of ["chorus", "flanger"] as const) {
      const [y] = renderCreativeFx(type, [x], SR, { rate: 10, depth: 1, delay: 30, feedback: 0.9, mix: 1 });
      expect(allFinite(y)).toBe(true);
      expect(peak(y)).toBeLessThan(8);
    }
  });

  it("decorrelates the channels with stereo spread and keeps them identical without", () => {
    const x = tone(700, 0.5, SR / 2);
    const spread = renderCreativeFx("chorus", [x, x], SR, { spread: 1, depth: 0.8 });
    const same = renderCreativeFx("chorus", [x, x], SR, { spread: 0, depth: 0.8 });
    expect(spread[0].some((v, i) => Math.abs(v - spread[1][i]) > 0.01)).toBe(true);
    expect(same[0].every((v, i) => v === same[1][i])).toBe(true);
  });
});

describe("phaser", () => {
  /** Magnitude of 0.5 * (1 + H^stages) for the first-order all-pass chain at `freq`. */
  const expectedGain = (freq: number, centre: number, stages: number) => {
    const a = PhaserProcessor.coefficient(SR, centre);
    const w = (2 * Math.PI * freq) / SR;
    // H(z) = (a + z^-1) / (1 + a z^-1)
    const numRe = a + Math.cos(w);
    const numIm = -Math.sin(w);
    const denRe = 1 + a * Math.cos(w);
    const denIm = -a * Math.sin(w);
    const d = denRe * denRe + denIm * denIm;
    const hRe = (numRe * denRe + numIm * denIm) / d;
    const hIm = (numIm * denRe - numRe * denIm) / d;
    const mag = Math.hypot(hRe, hIm);
    const phase = Math.atan2(hIm, hRe) * stages;
    return 0.5 * Math.hypot(1 + Math.pow(mag, stages) * Math.cos(phase), Math.pow(mag, stages) * Math.sin(phase));
  };

  it("a static 4-stage phaser has notches where the all-pass chain reaches 180 degrees, and none at low frequencies", () => {
    const params = { depth: 0, frequency: 1000, stages: 4, feedback: 0, mix: 0.5 };
    // notches at tan(w/2) = tan(wc/2) * tan(pi/8) and * tan(3pi/8)
    const t = Math.tan((Math.PI * 1000) / SR);
    const notches = [Math.tan(Math.PI / 8), Math.tan((3 * Math.PI) / 8)].map((k) => (SR / Math.PI) * Math.atan(t * k));
    expect(notches[0]).toBeGreaterThan(380);
    expect(notches[0]).toBeLessThan(450);
    for (const f of notches) {
      const y = renderCreativeFx("phaser", [tone(f, 1, SR)], SR, params)[0];
      expect(binAmp(y, f, SR / 2)).toBeLessThan(0.02);
      expect(expectedGain(f, 1000, 4)).toBeLessThan(0.01);
    }
    for (const f of [60, 200, 6000]) {
      const y = renderCreativeFx("phaser", [tone(f, 1, SR)], SR, params)[0];
      const measured = binAmp(y, f, SR / 2);
      expect(measured).toBeCloseTo(expectedGain(f, 1000, 4), 2);
    }
    const low = renderCreativeFx("phaser", [tone(60, 1, SR)], SR, params)[0];
    expect(binAmp(low, 60, SR / 2)).toBeGreaterThan(0.95);
  });

  it("more stages give more notches", () => {
    const notchCount = (stages: number) => {
      let count = 0;
      let prev = expectedGain(20, 1000, stages);
      let rising = false;
      for (let f = 30; f < 20000; f *= 1.02) {
        const g = expectedGain(f, 1000, stages);
        if (g > prev && !rising) rising = true;
        if (g < prev && rising && g < 0.2) {
          count += 1;
          rising = false;
        }
        prev = g;
      }
      return count;
    };
    expect(notchCount(8)).toBeGreaterThan(notchCount(2));
  });

  it("sweeps with the LFO and stays bounded with feedback", () => {
    const x = tone(1500, 1, SR * 2);
    const [y] = renderCreativeFx("phaser", [x], SR, { rate: 1, depth: 1, frequency: 800, feedback: 0.9, stages: 12, mix: 1 });
    expect(allFinite(y)).toBe(true);
    expect(peak(y)).toBeLessThan(8);
    const levels: number[] = [];
    for (let at = SR / 2; at + 480 <= y.length; at += 480) levels.push(rms(y, at, at + 480));
    expect(Math.max(...levels) / Math.max(1e-9, Math.min(...levels))).toBeGreaterThan(1.05);
  });
});

describe("distortion", () => {
  const base = { drive: 12, tone: 20000, level: 0, mix: 1 };
  const render = (mode: number, amp: number, extra: Record<string, number> = {}) => {
    const x = tone(1000, amp, SR);
    return renderCreativeFx("distortion", [x], SR, { ...base, mode, ...extra })[0];
  };

  it("soft clip adds odd harmonics only", () => {
    const y = render(0, 0.5);
    const fundamental = binAmp(y, 1000, SR / 2);
    expect(binAmp(y, 3000, SR / 2) / fundamental).toBeGreaterThan(0.05);
    expect(binAmp(y, 2000, SR / 2) / fundamental).toBeLessThan(0.002);
  });

  it("hard clip is harsher than soft clip", () => {
    const soft = render(0, 0.5);
    const hard = render(1, 0.5);
    expect(binAmp(hard, 3000, SR / 2) / binAmp(hard, 1000, SR / 2)).toBeGreaterThan(binAmp(soft, 3000, SR / 2) / binAmp(soft, 1000, SR / 2));
    expect(peak(hard)).toBeLessThanOrEqual(1.0001);
  });

  it("tube adds even harmonics and no DC offset", () => {
    const y = render(2, 0.5);
    expect(binAmp(y, 2000, SR / 2) / binAmp(y, 1000, SR / 2)).toBeGreaterThan(0.03);
    const mean = y.slice(SR / 2).reduce((a, b) => a + b, 0) / (SR / 2);
    expect(Math.abs(mean)).toBeLessThan(0.01);
  });

  it("is bounded and finite at maximum drive on a hot input, in every mode", () => {
    for (const mode of [0, 1, 2]) {
      const y = render(mode, 8, { drive: 40, level: 12 });
      expect(allFinite(y)).toBe(true);
      expect(peak(y)).toBeLessThan(4.2);
    }
  });

  it("mix 0 is the dry signal untouched", () => {
    const x = tone(330, 0.7, 4800);
    const [y] = renderCreativeFx("distortion", [x], SR, { ...base, mix: 0 });
    expect(y.every((v, i) => v === x[i])).toBe(true);
  });

  it("the tone filter removes the harmonics it sits below", () => {
    const bright = render(1, 0.5, { tone: 20000 });
    const dark = render(1, 0.5, { tone: 800 });
    expect(binAmp(dark, 5000, SR / 2)).toBeLessThan(binAmp(bright, 5000, SR / 2) * 0.3);
  });

  it("shapeSample curves are bounded and odd/asymmetric as documented", () => {
    for (const x of [-100, -3, -0.5, 0, 0.5, 3, 100]) {
      expect(Math.abs(shapeSample(0, x))).toBeLessThanOrEqual(1);
      expect(Math.abs(shapeSample(1, x))).toBeLessThanOrEqual(1);
      expect(Math.abs(shapeSample(2, x))).toBeLessThanOrEqual(1);
      expect(shapeSample(0, -x)).toBeCloseTo(-shapeSample(0, x), 12);
    }
    expect(shapeSample(2, -1)).not.toBeCloseTo(-shapeSample(2, 1), 3);
  });
});

describe("stereo width (mid/side)", () => {
  const left = tone(300, 0.6, 4800);
  const right = tone(470, 0.4, 4800);

  it("width 1 with no mid change is the identity", () => {
    const [l, r] = renderCreativeFx("stereoWidth", [left, right], SR, { width: 1, midGain: 0 });
    for (let i = 0; i < left.length; i++) {
      expect(Math.abs(l[i] - left[i])).toBeLessThan(1e-6);
      expect(Math.abs(r[i] - right[i])).toBeLessThan(1e-6);
    }
  });

  it("width 0 folds to mono: both channels equal (L+R)/2", () => {
    const [l, r] = renderCreativeFx("stereoWidth", [left, right], SR, { width: 0 });
    for (let i = 0; i < left.length; i++) {
      expect(Math.abs(l[i] - (left[i] + right[i]) / 2)).toBeLessThan(1e-6);
      expect(l[i]).toBe(r[i]);
    }
  });

  it("width 2 doubles the side signal: a left-only source becomes 1.5 L / -0.5 L", () => {
    const silent = new Float32Array(left.length);
    const [l, r] = renderCreativeFx("stereoWidth", [left, silent], SR, { width: 2 });
    for (let i = 0; i < left.length; i++) {
      expect(Math.abs(l[i] - 1.5 * left[i])).toBeLessThan(1e-6);
      expect(Math.abs(r[i] + 0.5 * left[i])).toBeLessThan(1e-6);
    }
  });

  it("balances mid and side independently: mid gain moves only the in-phase part", () => {
    const x = tone(440, 0.5, 4800);
    const inverted = Float32Array.from(x, (v) => -v);
    const [monoL] = renderCreativeFx("stereoWidth", [x, x], SR, { width: 1, midGain: -6.0206 });
    expect(rms(monoL) / rms(x)).toBeCloseTo(0.5, 3);
    const [sideL] = renderCreativeFx("stereoWidth", [x, inverted], SR, { width: 1, midGain: -6.0206 });
    expect(rms(sideL) / rms(x)).toBeCloseTo(1, 3);
  });

  it("passes further channels (5.1) through untouched", () => {
    const rest = tone(100, 0.3, 4800);
    const out = renderCreativeFx("stereoWidth", [left, right, rest], SR, { width: 0 });
    expect(out[2].every((v, i) => v === rest[i])).toBe(true);
  });
});

describe("invert polarity", () => {
  it("negates every sample exactly on the selected channels and leaves the rest alone", () => {
    const l = tone(220, 0.9, 4800);
    const r = tone(330, 0.7, 4800);
    const [both, bothR] = renderCreativeFx("invertPolarity", [l, r], SR, { left: 1, right: 1 });
    expect(both.every((v, i) => v === -l[i])).toBe(true);
    expect(bothR.every((v, i) => v === -r[i])).toBe(true);
    const [onlyLeft, keptRight] = renderCreativeFx("invertPolarity", [l, r], SR, { left: 1, right: 0 });
    expect(onlyLeft.every((v, i) => v === -l[i])).toBe(true);
    expect(keptRight.every((v, i) => v === r[i])).toBe(true);
  });

  it("cancels against the original when summed", () => {
    const x = tone(1000, 0.5, 4800);
    const [inv] = renderCreativeFx("invertPolarity", [x], SR, {});
    expect(x.every((v, i) => v + inv[i] === 0)).toBe(true);
  });
});

describe("channel swap / mono", () => {
  const l = tone(200, 0.5, 2400);
  const r = tone(900, 0.25, 2400);
  const run = (mode: number) => renderCreativeFx("channelMap", [l, r], SR, { mode });

  it("normal is the identity, swap exchanges the channels", () => {
    const [a, b] = run(0);
    expect(a.every((v, i) => v === l[i]) && b.every((v, i) => v === r[i])).toBe(true);
    const [c, d] = run(1);
    expect(c.every((v, i) => v === r[i]) && d.every((v, i) => v === l[i])).toBe(true);
  });

  it("mono sums to (L+R)/2 on both channels; left-to-both and right-to-both copy one side", () => {
    const [m1, m2] = run(2);
    for (let i = 0; i < l.length; i++) {
      expect(Math.abs(m1[i] - (l[i] + r[i]) / 2)).toBeLessThan(1e-7);
      expect(m1[i]).toBe(m2[i]);
    }
    const [l1, l2] = run(3);
    expect(l1.every((v, i) => v === l[i]) && l2.every((v, i) => v === l[i])).toBe(true);
    const [r1, r2] = run(4);
    expect(r1.every((v, i) => v === r[i]) && r2.every((v, i) => v === r[i])).toBe(true);
  });
});

describe("timeline clock", () => {
  const params: Record<string, Record<string, number>> = {
    chorus: { rate: 0.7, depth: 0.8, delay: 15, feedback: 0.3 },
    flanger: { rate: 1.3, depth: 0.9 },
    phaser: { rate: 0.9, depth: 0.9, feedback: 0.4 },
  };

  it("modulation follows the timeline: a render that starts 1 s in (or earlier, to warm up) matches the same stretch of the full render", () => {
    const full = tone(900, 0.5, SR * 3);
    for (const type of ["chorus", "flanger", "phaser"] as const) {
      const whole = renderCreativeFx(type, [full], SR, params[type], 128, 0)[0];
      // an export that starts at timeline 1.0 s, cold
      const from = SR;
      const late = renderCreativeFx(type, [full.slice(from)], SR, params[type], 128, 1)[0];
      // a render that starts at 0.5 s (pre-roll) and is compared from 1.0 s on
      const early = renderCreativeFx(type, [full.slice(SR / 2)], SR, params[type], 128, 0.5)[0];
      for (let i = SR / 2; i < SR * 1.5; i++) {
        expect(Math.abs(late[i] - whole[from + i]), `${type} late @${i}`).toBeLessThan(1e-4);
        expect(Math.abs(early[from - SR / 2 + i] - whole[from + i]), `${type} early @${i}`).toBeLessThan(1e-4);
      }
    }
  });

  it("without a clock the LFO starts at phase 0 (the previous free-running behaviour) and a seek re-anchors it", () => {
    const x = tone(900, 0.5, 12800);
    const free = renderCreativeFx("chorus", [x], SR, params.chorus);
    const anchoredAtZero = renderCreativeFx("chorus", [x], SR, params.chorus, 128, 0);
    expect(free[0].every((v, i) => v === anchoredAtZero[0][i])).toBe(true);
    // play 6400 samples, then seek to timeline second 100.5 and play on
    const proc = createCreativeProcessor("chorus", SR, params.chorus);
    const played: number[] = [];
    const out = [new Float32Array(128)];
    let offset = 0;
    for (let at = 0; at < x.length; at += 128) {
      if (at === 6400) offset = 100.5 - at / SR;
      proc.setClock(at / SR, offset);
      proc.process([x.subarray(at, at + 128)], out, 128);
      played.push(...out[0]);
    }
    const reference = free[0];
    expect(played.slice(0, 6400).every((v, i) => v === reference[i])).toBe(true);
    expect(played.slice(6400 + 2048).some((v, i) => Math.abs(v - reference[6400 + 2048 + i]) > 1e-3)).toBe(true);
  });

  it("rounding noise in the offset (a rack edit during playback) does not re-anchor", () => {
    const x = tone(900, 0.5, 2560);
    const proc = createCreativeProcessor("chorus", SR, params.chorus);
    const out = [new Float32Array(128)];
    const rendered: number[] = [];
    for (let at = 0; at < x.length; at += 128) {
      proc.setClock(at / SR, 12.3456 + (at / 128) * 1e-13);
      proc.process([x.subarray(at, at + 128)], out, 128);
      rendered.push(...out[0]);
    }
    const steady = renderCreativeFx("chorus", [x], SR, params.chorus, 128, 12.3456)[0];
    expect(rendered.every((v, i) => v === steady[i])).toBe(true);
  });
});

describe("shared behaviour", () => {
  it("block size never changes the result (the worklet's 128 frames match any other chunking)", () => {
    const x = [tone(523, 0.6, 9000), tone(311, 0.4, 9000)];
    const params: Record<string, Record<string, number>> = {
      chorus: { depth: 0.7, spread: 0.6, feedback: 0.3 },
      flanger: {},
      phaser: { feedback: 0.5, stages: 6 },
      distortion: { mode: 2, drive: 20 },
      stereoWidth: { width: 1.4, midGain: 2 },
      invertPolarity: { left: 1, right: 0 },
      channelMap: { mode: 2 },
    };
    for (const type of CREATIVE_FX_TYPES) {
      const a = renderCreativeFx(type, x, SR, params[type], 128);
      const b = renderCreativeFx(type, x, SR, params[type], 77);
      const c = renderCreativeFx(type, x, SR, params[type], 4096);
      for (let ch = 0; ch < 2; ch++) {
        expect(a[ch].every((v, i) => v === b[ch][i] && v === c[ch][i]), type).toBe(true);
        expect(allFinite(a[ch]), type).toBe(true);
      }
    }
  });

  it("silence in is silence out (no denormal or DC residue) for every effect", () => {
    const silent = [new Float32Array(SR / 2), new Float32Array(SR / 2)];
    for (const type of CREATIVE_FX_TYPES) {
      const out = renderCreativeFx(type, silent, SR, {});
      for (const channel of out) expect(peak(channel), type).toBeLessThan(1e-6);
    }
  });

  it("glides to a new parameter value instead of jumping (no click when an edit or an automation step lands)", () => {
    const proc = createCreativeProcessor("stereoWidth", SR, { width: 1 });
    const x = tone(440, 0.5, 4800);
    const out = [new Float32Array(4800), new Float32Array(4800)];
    proc.setParams({ width: 0 });
    proc.process([x, Float32Array.from(x, (v) => -v)], out, 4800);
    // the side signal (anti-phase) fades out over ~10 ms instead of vanishing at once
    const ratio = out[0][100] / x[100];
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.99);
    expect(rms(out[0], 3600, 4800)).toBeLessThan(0.01);
  });
});

describe("non-finite input", () => {
  it("a NaN or Infinity sample never poisons the feedback or filter state of stateful effects", () => {
    for (const type of ["chorus", "flanger", "phaser", "distortion"] as const) {
      const input = Float32Array.from({ length: 4000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 300 * i) / SR));
      input[10] = Number.NaN;
      input[20] = Number.POSITIVE_INFINITY;
      const out = renderCreativeFx(type, [input, input.slice()], SR, { feedback: 0.9 });
      for (const channel of out) for (const v of channel) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
