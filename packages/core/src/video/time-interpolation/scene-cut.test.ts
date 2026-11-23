import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RGBAFrame } from "./frame-blend";
import { GpuOpticalFlow } from "./optical-flow-gpu";
import { detectSceneCut } from "./scene-cut";
import { crossDissolve, fade, noiseTexture, pan, renderScene, rotatingDisc, shapesScene, texture, translatingSquare, type SceneFn } from "./synthetic-scenes";
import { TimeInterpolator } from "./time-interpolator";
import { planSourceSamples } from "./types";

const W = 96;
const H = 64;
const render = (fn: SceneFn, s = 0): RGBAFrame => renderScene(fn, W, H, s, 1);

// ---- test set -------------------------------------------------------------------------------------------

const noise = (seed: number, gain = 1, off = 0): SceneFn => (x, y) => {
  const c = noiseTexture(x, y, seed);
  return [Math.min(255, c[0] * gain + off), Math.min(255, c[1] * gain + off), Math.min(255, c[2] * gain + off)];
};
const sin = (seed: number, gain = 1, off = 0): SceneFn => (x, y) => {
  const c = texture(x, y, seed);
  return [Math.min(255, c[0] * gain + off), Math.min(255, c[1] * gain + off), Math.min(255, c[2] * gain + off)];
};
const scaled = (fn: SceneFn, k: (s: number) => number): SceneFn => (x, y, s) => fn(x, y, s).map((c) => c * k(s)) as [number, number, number];

const F = 128 * 72 * 4;
const fixture = gunzipSync(readFileSync(new URL("./__fixtures__/testsrc2-frames-128x72.rgba.gz", import.meta.url)));
const ffmpegFrame = (index: number): RGBAFrame => ({ width: 128, height: 72, data: new Uint8ClampedArray(fixture.subarray(index * F, (index + 1) * F)) });
// layout: see __fixtures__/README.md
const TS = (i: number): RGBAFrame => ffmpegFrame(i);
const TS_FAR = [12, 13, 14, 15];
const OTHER = ["testsrc2 flipped", "rgbtestsrc", "smptebars", "mandelbrot", "gradients", "testsrc2 negated"];

interface Case {
  name: string;
  group: string;
  a: RGBAFrame;
  b: RGBAFrame;
}
const cuts: Case[] = [];
const notCuts: Case[] = [];
const add = (list: Case[], group: string, name: string, a: RGBAFrame, b: RGBAFrame): void => {
  list.push({ group, name, a, b });
};

for (const [p, q] of [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]]) add(cuts, "cut: unrelated pictures", `noise ${p} -> ${q}`, render(noise(p)), render(noise(q)));
add(cuts, "cut: unrelated pictures", "dark -> bright", render(noise(1, 0.4)), render(noise(2, 1.2, 20)));
for (const [p, q] of [[1, 2], [3, 4], [5, 6]]) add(cuts, "cut: unrelated pictures", `shapes ${p} -> ${q}`, render(shapesScene(W, H, p)), render(shapesScene(W, H, q)));
for (const [p, q] of [[1, 2], [3, 4]]) add(cuts, "cut: unrelated pictures", `noise ${p} -> shapes ${q}`, render(noise(p)), render(shapesScene(W, H, q)));
add(cuts, "cut: unrelated pictures", "pan -> moving square", render(pan(4, 0), 3), render(translatingSquare(W, H, 3, 1), 2));
for (const [p, q] of [[0.9, 3.3], [1.1, 2.2], [0.5, 4.2], [2.7, 5.1], [3.9, 6.3], [1.7, 0.2]]) add(cuts, "cut: periodic sinusoid pictures (known weak)", `sin ${p} -> ${q}`, render(sin(p)), render(sin(q)));
add(cuts, "cut: periodic sinusoid pictures (known weak)", "sin dark -> bright", render(sin(0.9, 0.4)), render(sin(3.3, 1.2, 20)));
OTHER.forEach((name, i) => {
  add(cuts, "cut: testsrc2 -> other lavfi source", `${name} (a)`, TS(3 + i), ffmpegFrame(16 + i * 2));
  add(cuts, "cut: testsrc2 -> other lavfi source", `${name} (b)`, TS(9), ffmpegFrame(17 + i * 2));
});

for (const v of [1, 4, 8, 12, 16, 24]) add(notCuts, "not a cut: pan", `noise pan ${v} px/frame`, render((x, y, s) => noise(1)(x - v * s, y, s), 0), render((x, y, s) => noise(1)(x - v * s, y, s), 1));
for (const v of [8, 16]) add(notCuts, "not a cut: pan", `noise vertical pan ${v} px/frame`, render((x, y, s) => noise(1)(x, y - v * s, s), 0), render((x, y, s) => noise(1)(x, y - v * s, s), 1));
for (const v of [1, 3, 6, 10, 16, 24]) add(notCuts, "not a cut: pan", `sin pan ${v} px/frame`, render(pan(v, 0), 0), render(pan(v, 0), 1));
for (const v of [6, 10, 16]) add(notCuts, "not a cut: pan", `sin diagonal pan ${v} px/frame`, render(pan(v * 0.7, -v * 0.7), 0), render(pan(v * 0.7, -v * 0.7), 1));
for (const v of [2, 6, 10, 14]) add(notCuts, "not a cut: motion", `square ${v} px/frame`, render(translatingSquare(W, H, v, v / 2), 0), render(translatingSquare(W, H, v, v / 2), 1));
for (const d of [3, 8, 15, 25]) add(notCuts, "not a cut: motion", `disc ${d} deg/frame`, render(rotatingDisc(W, H, d), 0), render(rotatingDisc(W, H, d), 1));
for (const [g, o] of [[1.6, 70], [0.3, 200], [0.25, 0], [2.2, 0], [1.0, 90]]) add(notCuts, "not a cut: flash", `noise gain ${g} +${o}`, render(noise(1)), render(noise(1, g, o)));
for (const [g, o] of [[1.6, 70], [0.3, 200], [0.25, 0], [1.0, 90], [2.2, 0], [0.5, 120]]) add(notCuts, "not a cut: flash", `sin gain ${g} +${o}`, render(sin(0.9)), render(sin(0.9, g, o)));
for (const [s0, s1] of [[0, 0.1], [0.4, 0.5], [0.8, 0.9], [0, 0.3]]) add(notCuts, "not a cut: fade", `noise fade ${s0}-${s1}`, render(scaled(noise(1), (s) => 1 - s), s0), render(scaled(noise(1), (s) => 1 - s), s1));
for (const [s0, s1] of [[0, 0.1], [0.3, 0.4], [0.7, 0.8], [0, 0.3]]) add(notCuts, "not a cut: fade", `sin fade ${s0}-${s1}`, render(fade(), s0), render(fade(), s1));
for (const [s0, s1] of [[0, 0.1], [0.4, 0.5], [0, 0.25], [0.3, 0.7]]) add(notCuts, "not a cut: dissolve step", `sin dissolve ${s0}-${s1}`, render(crossDissolve(), s0), render(crossDissolve(), s1));
const mix = (s: number): SceneFn => (x, y) => noise(1)(x, y, 0).map((c, i) => c * (1 - s) + noise(2)(x, y, 0)[i] * s) as [number, number, number];
for (const [s0, s1] of [[0, 0.1], [0.4, 0.5], [0.3, 0.7]]) add(notCuts, "not a cut: dissolve step", `noise dissolve ${s0}-${s1}`, render(mix(s0)), render(mix(s1)));
for (const step of [1, 2, 4]) for (const i of [0, 4, 7]) add(notCuts, "not a cut: testsrc2 motion", `testsrc2 frame ${i} -> ${i + step}`, TS(i), TS(i + step));
TS_FAR.forEach((far, k) => add(notCuts, "not a cut: same scene seconds later", `testsrc2 frame ${k} -> far ${far}`, TS(k), TS(far)));

describe("scene-cut detection on the test set", () => {
  const verdicts = (cases: Case[]): Array<{ c: Case; isCut: boolean }> => cases.map((c) => ({ c, isCut: detectSceneCut(c.a, c.b).isCut }));

  it("reports the false-positive and false-negative rates", () => {
    const cutV = verdicts(cuts);
    const noV = verdicts(notCuts);
    const missed = cutV.filter((v) => !v.isCut);
    const wrong = noV.filter((v) => v.isCut);
    const byGroup = new Map<string, { n: number; hit: number }>();
    for (const v of [...cutV, ...noV]) {
      const g = byGroup.get(v.c.group) ?? { n: 0, hit: 0 };
      g.n++;
      if (v.isCut) g.hit++;
      byGroup.set(v.c.group, g);
    }
    for (const [group, g] of byGroup) console.log(`[scene-cut] ${group}: ${g.hit}/${g.n} flagged as cut`);
    console.log(`[scene-cut] false negatives ${missed.length}/${cuts.length} (${((100 * missed.length) / cuts.length).toFixed(1)}%): ${missed.map((v) => v.c.name).join(", ") || "none"}`);
    console.log(`[scene-cut] false positives ${wrong.length}/${notCuts.length} (${((100 * wrong.length) / notCuts.length).toFixed(1)}%): ${wrong.map((v) => v.c.name).join(", ") || "none"}`);
    expect(cuts.length).toBeGreaterThanOrEqual(30);
    expect(notCuts.length).toBeGreaterThanOrEqual(60);
    expect(wrong.map((v) => v.c.name)).toEqual([]);
    // Known false negatives: the sinusoid pictures are periodic, so any two of them correlate at some translation and
    // share the same tonal distribution; "pan -> moving square" shares the periodic family too. These are accepted
    // (a missed cut falls back to the previous behaviour: an interpolated frame) and pinned so a change is noticed.
    const known = ["pan -> moving square", "sin 0.9 -> 3.3", "sin 1.1 -> 2.2", "sin 0.5 -> 4.2", "sin 2.7 -> 5.1", "sin 3.9 -> 6.3", "sin 1.7 -> 0.2", "sin dark -> bright"];
    expect(missed.map((v) => v.c.name).sort()).toEqual(known.sort());
  });

  it("is symmetric: reversing the pair (a reversed clip) gives the same verdict", () => {
    for (const c of [...cuts, ...notCuts]) expect(detectSceneCut(c.b, c.a).isCut, c.name).toBe(detectSceneCut(c.a, c.b).isCut);
  });

  it("treats frames of different sizes as a cut and never throws", () => {
    expect(detectSceneCut(render(noise(1)), { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) }).isCut).toBe(true);
  });
});

describe("scene-cut detection: flat frames and low-contrast cuts", () => {
  const flat = (v: number): RGBAFrame => render(() => [v, v, v]);
  it("never treats a flash to white, a black frame or a clipped exposure as a cut, whatever the other picture", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const base = render(noise(seed, 0.5, 40));
      for (const other of [flat(255), flat(0), flat(128), render(noise(seed, 1, 230)), render(noise(seed, 4, 255))]) {
        expect(detectSceneCut(base, other).isCut, `seed ${seed} forward`).toBe(false);
        expect(detectSceneCut(other, base).isCut, `seed ${seed} reverse`).toBe(false);
      }
    }
  });
  it("still detects a cut between two low-contrast shots of similar colour", () => {
    for (const [p, q] of [[108, 109], [110, 111], [112, 113]]) {
      expect(detectSceneCut(render(noise(p, 0.6, 60)), render(noise(q, 0.6, 60))).isCut, `${p}->${q}`).toBe(true);
    }
  });
});

// ---- interpolator: a cut outputs exactly frame A or frame B, identically on every backend ----------------------

afterEach(() => {
  vi.restoreAllMocks();
});

function job(frames: Map<number, RGBAFrame>, frame: number, t: number, mode: "frameBlending" | "opticalFlow") {
  return {
    mode,
    sourceKey: `cut-${mode}-${frame}-${t}`,
    plan: planSourceSamples((frame + t) / 25, 25),
    quality: "low" as const,
    loadFrame: async (time: number) => frames.get(Math.round(time * 25)) ?? null,
  };
}

describe("TimeInterpolator at a cut", () => {
  const A = render(noise(1));
  const B = render(noise(2));
  const cutFrames = new Map<number, RGBAFrame>([[10, A], [11, B]]);
  const panFrames = new Map<number, RGBAFrame>([[10, render(pan(3, 1), 0)], [11, render(pan(3, 1), 1)]]);

  for (const mode of ["frameBlending", "opticalFlow"] as const) {
    it(`${mode}: output is exactly frame A before the midpoint and exactly frame B from it`, async () => {
      for (const t of [0.1, 0.25, 0.49, 0.5, 0.75, 0.9]) {
        const interp = new TimeInterpolator();
        interp.setBackend("cpu");
        const out = await interp.render(job(cutFrames, 10, t, mode));
        expect(out?.path).toBe("cut");
        expect(Array.from(out!.data)).toEqual(Array.from((t < 0.5 ? A : B).data));
        expect(interp.stats.cutFrames).toBe(1);
        expect(interp.stats.cpuFrames + interp.stats.blendFrames).toBe(0);
      }
    });
    it(`${mode}: a pan is still interpolated`, async () => {
      const interp = new TimeInterpolator();
      interp.setBackend("cpu");
      const out = await interp.render(job(panFrames, 10, 0.5, mode));
      expect(out?.path).toBe(mode === "frameBlending" ? "blend" : "cpu");
      expect(interp.stats.cutFrames).toBe(0);
    });
  }

  it("decides once per pair, for every t between the same two frames", async () => {
    const interp = new TimeInterpolator();
    interp.setBackend("cpu");
    for (const t of [0.25, 0.5, 0.75]) await interp.render({ ...job(cutFrames, 10, t, "opticalFlow"), sourceKey: "same" });
    expect(interp.stats.cutChecks).toBe(1);
    expect(interp.stats.cutFrames).toBe(3);
  });

  it("the GPU backend makes the same decision: a cut never reaches the GPU, a non-cut does", async () => {
    const prepare = vi.fn(() => ({ width: W, height: H, destroy: () => undefined }));
    const synthesize = vi.fn(async () => new Uint8ClampedArray(W * H * 4).fill(7));
    const fake = { isLost: false, prepare, synthesize, dispose: () => undefined } as unknown as GpuOpticalFlow;
    vi.spyOn(GpuOpticalFlow, "create").mockResolvedValue(fake);

    const gpuInterp = new TimeInterpolator();
    gpuInterp.setBackend("gpu");
    const cpuInterp = new TimeInterpolator();
    cpuInterp.setBackend("cpu");
    for (const t of [0.2, 0.7]) {
      const g = await gpuInterp.render({ ...job(cutFrames, 10, t, "opticalFlow"), sourceKey: `g${t}` });
      const c = await cpuInterp.render({ ...job(cutFrames, 10, t, "opticalFlow"), sourceKey: `c${t}` });
      expect(g?.path).toBe("cut");
      expect(Array.from(g!.data)).toEqual(Array.from(c!.data));
    }
    expect(prepare).not.toHaveBeenCalled();

    const g = await gpuInterp.render({ ...job(panFrames, 10, 0.5, "opticalFlow"), sourceKey: "gpan" });
    expect(g?.path).toBe("gpu");
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
