import { describe, expect, it } from "vitest";
import {
  LoudnessMeter,
  LoudnessNormalizer,
  TruePeakLimiter,
  TruePeakMeter,
  kHighPassCoefficients,
  kShelfCoefficients,
  kWeightingMagnitudeDb,
  linearToDb,
  measureLoudness,
  measureRenderedLoudness,
  planClipNormalization,
  planNormalization,
} from "./index";

const FS = 48000;
const db = (x: number) => Math.pow(10, x / 20);

/** Stereo sine segments: [seconds, peak dBFS, frequency Hz]. */
function stereoSine(segments: Array<[number, number, number?]>, fs = FS): Float32Array[] {
  const total = segments.reduce((s, [sec]) => s + Math.round(sec * fs), 0);
  const l = new Float32Array(total);
  const r = new Float32Array(total);
  let at = 0;
  let phaseIndex = 0;
  for (const [sec, level, freq = 1000] of segments) {
    const n = Math.round(sec * fs);
    const amp = db(level);
    for (let i = 0; i < n; i++, phaseIndex++) {
      const v = amp * Math.sin((2 * Math.PI * freq * phaseIndex) / fs);
      l[at + i] = v;
      r[at + i] = v;
    }
    at += n;
  }
  return [l, r];
}

describe("K-weighting coefficients (BS.1770-4 Annex 1 at 48 kHz)", () => {
  it("matches the tabulated 48 kHz biquads", () => {
    const shelf = kShelfCoefficients(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 9);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 9);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 9);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 9);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 9);
    const hp = kHighPassCoefficients(48000);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 9);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 9);
  });

  it("keeps the same analogue response at other sample rates", () => {
    for (const fs of [44100, 48000, 96000]) {
      // +0.691 dB at 1 kHz is what the -0.691 LKFS offset compensates.
      expect(kWeightingMagnitudeDb(997, fs)).toBeCloseTo(0.691, 1);
      expect(kWeightingMagnitudeDb(10000, fs)).toBeGreaterThan(3.5);
      expect(kWeightingMagnitudeDb(20, fs)).toBeLessThan(-5);
    }
  });
});

describe("EBU Tech 3341 conformance (generated test signals)", () => {
  it("case 1: stereo 1 kHz sine at -23 dBFS reads -23.0 LUFS (M, S and I)", () => {
    const meter = new LoudnessMeter(FS, 2);
    meter.process(stereoSine([[20, -23]]));
    expect(meter.momentary()).toBeCloseTo(-23.0, 1);
    expect(meter.shortTerm()).toBeCloseTo(-23.0, 1);
    expect(meter.integrated()).toBeCloseTo(-23.0, 1);
    expect(meter.truePeak()).toBeCloseTo(-23.0, 1);
  });

  it("case 2: the same sine at -33 dBFS reads -33.0 LUFS", () => {
    expect(measureLoudness(stereoSine([[20, -33]]), FS).integrated).toBeCloseTo(-33.0, 1);
  });

  it("case 3: -36 / -23 / -36 LUFS sections gate down to -23.0 LUFS (relative gate)", () => {
    const r = measureLoudness(
      stereoSine([
        [20, -36],
        [60, -23],
        [20, -36],
      ]),
      FS,
    );
    expect(r.integrated).toBeCloseTo(-23.0, 1);
  });

  it("case 4: -72 / -23 / -72 sections gate down to -23.0 LUFS (absolute gate)", () => {
    const r = measureLoudness(
      stereoSine([
        [20, -72],
        [20, -23],
        [20, -72],
      ]),
      FS,
    );
    // Spec tolerance is +-0.1 LU; blocks straddling a level change legitimately pass the gate.
    expect(Math.abs(r.integrated + 23.0)).toBeLessThanOrEqual(0.1);
  });

  it("case 5: -26 / -20 / -26 sections integrate to the energy mean inside the gate", () => {
    const r = measureLoudness(
      stereoSine([
        [20, -26],
        [10, -20],
        [20, -26],
      ]),
      FS,
    );
    const expected = 10 * Math.log10((40 * Math.pow(10, -2.6) + 10 * Math.pow(10, -2.0)) / 50);
    expect(r.integrated).toBeCloseTo(expected, 1);
  });

  it("is sample-rate independent: 44.1 kHz and 96 kHz read -23.0 LUFS too", () => {
    for (const fs of [44100, 96000]) {
      expect(measureLoudness(stereoSine([[15, -23]], fs), fs).integrated).toBeCloseTo(-23.0, 1);
    }
  });

  it("momentary tracks the last 400 ms and the maximum is held", () => {
    const meter = new LoudnessMeter(FS, 2);
    meter.process(stereoSine([[3, -23]]));
    meter.process(stereoSine([[1, -43]]));
    expect(meter.momentary()).toBeCloseTo(-43.0, 1);
    expect(meter.snapshot().momentaryMax).toBeCloseTo(-23.0, 1);
  });

  it("arbitrary chunking gives the same result as one pass", () => {
    const signal = stereoSine([
      [8, -30],
      [8, -20],
    ]);
    const whole = measureLoudness(signal, FS);
    const meter = new LoudnessMeter(FS, 2);
    let at = 0;
    const sizes = [128, 441, 4799, 4800, 4801, 12345, 77];
    for (let k = 0; at < signal[0].length; k++) {
      const n = Math.min(sizes[k % sizes.length], signal[0].length - at);
      meter.process([signal[0].subarray(at, at + n), signal[1].subarray(at, at + n)]);
      at += n;
    }
    const chunked = meter.snapshot();
    expect(chunked.integrated).toBeCloseTo(whole.integrated, 6);
    expect(chunked.loudnessRange).toBeCloseTo(whole.loudnessRange, 6);
    expect(chunked.truePeak).toBeCloseTo(whole.truePeak, 6);
  });

  it("a mono source reads 3 LU lower than the same sine on both stereo channels", () => {
    const [l] = stereoSine([[10, -23]]);
    const mono = measureLoudness([l], FS).integrated;
    expect(mono).toBeCloseTo(-26.0, 1);
    expect(measureLoudness([l], FS, { dualMono: true }).integrated).toBeCloseTo(-23.0, 1);
  });

  it("silence has no integrated loudness", () => {
    const r = measureLoudness([new Float32Array(FS * 5), new Float32Array(FS * 5)], FS);
    expect(r.integrated).toBe(-Infinity);
    expect(r.loudnessRange).toBe(0);
    expect(r.truePeak).toBe(-Infinity);
  });
});

describe("EBU Tech 3342 loudness range", () => {
  const lra = (segments: Array<[number, number]>) => measureLoudness(stereoSine(segments), FS).loudnessRange;

  it("case 1: -20 / -30 LUFS (20 s each) = 10 LU", () => {
    expect(Math.abs(lra([[20, -20], [20, -30]]) - 10)).toBeLessThanOrEqual(1);
  });
  it("case 2: -20 / -15 LUFS = 5 LU", () => {
    expect(Math.abs(lra([[20, -20], [20, -15]]) - 5)).toBeLessThanOrEqual(1);
  });
  it("case 3: -40 / -20 LUFS = 20 LU", () => {
    expect(Math.abs(lra([[20, -40], [20, -20]]) - 20)).toBeLessThanOrEqual(1);
  });
  it("case 4: -50 / -35 / -20 / -35 / -50 LUFS = 15 LU (-50 falls under the relative gate)", () => {
    expect(
      Math.abs(lra([[20, -50], [20, -35], [20, -20], [20, -35], [20, -50]]) - 15),
    ).toBeLessThanOrEqual(1);
  });
  it("a constant tone has a loudness range of ~0 LU", () => {
    expect(lra([[30, -23]])).toBeLessThan(0.1);
  });
});

describe("true peak (4x oversampling)", () => {
  /** fs/4 sine with a 45 degree phase: every sample is +-0.707 of the amplitude. */
  const quarterRate = (amp: number, seconds = 1) => {
    const n = FS * seconds;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = amp * Math.sin((Math.PI / 2) * i + Math.PI / 4);
    return d;
  };

  it("finds the inter-sample peak a sample-peak meter misses (0 dBFS fs/4 sine)", () => {
    const d = quarterRate(1);
    const meter = new TruePeakMeter(1);
    meter.process([d]);
    expect(linearToDb(meter.samplePeakLinear)).toBeCloseTo(-3.01, 1);
    expect(linearToDb(meter.linear)).toBeGreaterThan(-0.3);
    expect(linearToDb(meter.linear)).toBeLessThan(0.3);
  });

  it("reads -6 dBTP for a -6 dBFS fs/4 sine and -3 dBTP for a -3 dBFS 1 kHz sine", () => {
    const six = new TruePeakMeter(1);
    six.process([quarterRate(db(-6))]);
    expect(linearToDb(six.linear)).toBeCloseTo(-6.0, 0);
    const [l] = stereoSine([[2, -3]]);
    const three = new TruePeakMeter(1);
    three.process([l]);
    expect(linearToDb(three.linear)).toBeCloseTo(-3.0, 1);
  });
});

describe("clip normalization plan", () => {
  it("sets the scalar volume so the measured loudness lands on the target", () => {
    const plan = planClipNormalization({ id: "c", volume: 1 }, { integrated: -26, truePeak: -12 }, -14);
    expect(plan.requestedGainDb).toBeCloseTo(12, 9);
    expect(plan.clamped).toBe(false);
    expect(plan.action).toEqual({
      type: "audio/setVolume",
      params: { clipId: "c", volume: expect.closeTo(Math.pow(10, 12 / 20), 9) },
    });
    expect(plan.resultingLufs).toBeCloseTo(-14, 9);
    expect(plan.resultingTruePeakDb).toBeCloseTo(0, 9);
  });

  it("clamps at +12 dB of clip volume and says so", () => {
    const plan = planClipNormalization({ id: "c", volume: 1 }, { integrated: -40, truePeak: -30 }, -14);
    expect(plan.clamped).toBe(true);
    expect(plan.appliedGainDb).toBeCloseTo(12.04, 1);
    expect(plan.resultingLufs).toBeCloseTo(-40 + plan.appliedGainDb, 9);
  });

  it("scales volume automation when the clip has a lane, and ignores silence", () => {
    const plan = planClipNormalization(
      { id: "c", volume: 1, automation: { volume: [{ time: 0, value: 0.5 }, { time: 2, value: 1 }] } },
      { integrated: -20, truePeak: -8 },
      -23,
    );
    expect(plan.action?.type).toBe("audio/addAutomation");
    const points = (plan.action as { params: { points: { value: number }[] } }).params.points;
    expect(points[1].value / points[0].value).toBeCloseTo(2, 9);
    expect(points[1].value).toBeCloseTo(Math.pow(10, -3 / 20), 9);
    expect(
      planClipNormalization({ id: "c", volume: 1 }, { integrated: -Infinity, truePeak: -Infinity }, -14).silent,
    ).toBe(true);
  });
});

describe("true-peak limiter and normalizer", () => {
  it("planNormalization derives gain and flags peaks that exceed the ceiling", () => {
    const p = planNormalization({ integrated: -23, truePeak: -10 }, { targetLufs: -16, truePeakCeilingDb: -1 });
    expect(p.gainDb).toBeCloseTo(7, 9);
    expect(p.predictedTruePeakDb).toBeCloseTo(-3, 9);
    expect(p.limiterRequired).toBe(false);
    const q = planNormalization({ integrated: -23, truePeak: -4 }, { targetLufs: -16, truePeakCeilingDb: -1 });
    expect(q.limiterRequired).toBe(true);
    expect(planNormalization({ integrated: -Infinity, truePeak: -Infinity }, { targetLufs: -16, truePeakCeilingDb: -1 }).silent).toBe(true);
  });

  it("limits a hot signal under the ceiling without changing its length", () => {
    const [l, r] = stereoSine([[3, 0]]);
    // Transient spikes the limiter must catch.
    for (const at of [20000, 60000, 100000]) {
      l[at] = r[at] = 1;
    }
    const limiter = new TruePeakLimiter(FS, 2, -1);
    const parts = [
      limiter.process([l.subarray(0, 50000), r.subarray(0, 50000)]),
      limiter.process([l.subarray(50000), r.subarray(50000)]),
      limiter.flush(),
    ];
    const total = parts.reduce((s, p) => s + p[0].length, 0);
    expect(total).toBe(l.length);
    const out = [0, 1].map((c) => {
      const d = new Float32Array(total);
      let at = 0;
      for (const p of parts) {
        d.set(p[c], at);
        at += p[c].length;
      }
      return d;
    });
    const tp = new TruePeakMeter(2);
    tp.process(out);
    expect(linearToDb(tp.linear)).toBeLessThanOrEqual(-1 + 0.1);
    expect(linearToDb(tp.linear)).toBeGreaterThan(-1.5);
  });

  it("normalizes program material to the target within 0.1 LU, with the ceiling intact", () => {
    // Speech-like program: loud and quiet passages plus pauses.
    const source = stereoSine([
      [10, -30, 220],
      [10, -22, 440],
      [5, -60, 330],
      [10, -26, 880],
    ]);
    const before = measureLoudness(source, FS);
    for (const targetLufs of [-14, -16, -23]) {
      const target = { targetLufs, truePeakCeilingDb: -1 };
      const plan = planNormalization(before, target);
      const normalizer = new LoudnessNormalizer(plan, target, FS, 2);
      const head = normalizer.process(source, source[0].length);
      const tail = normalizer.flush();
      const meter = new LoudnessMeter(FS, 2);
      meter.process(head);
      if (tail.length) meter.process(tail);
      const after = meter.snapshot();
      expect(Math.abs(after.integrated - targetLufs)).toBeLessThan(0.1);
      expect(after.truePeak).toBeLessThanOrEqual(-1 + 0.1);
    }
  });

  it("measureRenderedLoudness over 15 s chunks equals the one-shot measurement", async () => {
    const signal = stereoSine([
      [20, -30],
      [20, -20],
    ]);
    const whole = measureLoudness(signal, FS);
    const seen: number[] = [];
    const chunked = await measureRenderedLoudness({
      sampleRate: FS,
      channels: 2,
      duration: 40,
      render: async (start, duration) => ({
        sampleRate: FS,
        channels: signal.map((c) => c.subarray(Math.round(start * FS), Math.round((start + duration) * FS))),
      }),
      onProgress: (f) => seen.push(f),
    });
    expect(chunked.integrated).toBeCloseTo(whole.integrated, 6);
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.length).toBe(3);
  });
});
