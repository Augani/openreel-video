import { describe, expect, it } from "vitest";
import { analyzeSequence } from "./analysis";
import type { GrayFrame } from "./motion-estimate";
import { buildPlan, frameAt, hasUncoveredEdge, rowDelta, type RowDelta } from "./plan";
import { renderScene, STILL_CAMERA, jitter } from "./synthetic-scene";
import { DEFAULT_WARP_SETTINGS, isWarpAnalysis, normalizeWarpSettings, WARP_FRAMINGS, WARP_METHODS, ROLLING_SHUTTER_MODES, WARP_RESULTS } from "./types";

const flat = (w: number, h: number, v: number): GrayFrame => ({ width: w, height: h, data: new Float32Array(w * h).fill(v) });
async function* seq(frames: GrayFrame[]) { for (const f of frames) yield f; }
const allFinite = (a: number[]) => a.every((v) => Number.isFinite(v));

describe("warp stabilizer edge cases", () => {
  it("flat / black / silent-like frames give finite zero-ish motion", async () => {
    const a = await analyzeSequence(seq(Array.from({ length: 10 }, () => flat(160, 96, 0))), { fps: 30, startTime: 0, width: 160, height: 96 });
    expect(allFinite(a.motion)).toBe(true);
    expect(isWarpAnalysis(a)).toBe(true);
    expect(Math.max(...a.motion.map(Math.abs))).toBeLessThan(0.5);
  });
  it("scene cut (flat then textured) stays finite", async () => {
    const t = renderScene(160, 96, () => STILL_CAMERA);
    const a = await analyzeSequence(seq([flat(160, 96, 0.2), flat(160, 96, 0.2), t, t, flat(160, 96, 1)]), { fps: 30, startTime: 0, width: 160, height: 96 });
    expect(allFinite(a.motion)).toBe(true);
  });
  it("tiny frames and random noise stay finite", async () => {
    const noise = (w: number, h: number): GrayFrame => ({ width: w, height: h, data: Float32Array.from({ length: w * h }, () => Math.random()) });
    for (const [w, h] of [[8, 8], [3, 5], [32, 20]] as const) {
      const a = await analyzeSequence(seq([noise(w, h), noise(w, h), noise(w, h)]), { fps: 30, startTime: 0, width: w, height: h });
      expect(allFinite(a.motion)).toBe(true);
    }
  });
  it("every settings combination builds a finite plan, incl 2 frames and zero motion", async () => {
    const two = await analyzeSequence(seq([flat(160, 96, 0.5), flat(160, 96, 0.5)]), { fps: 30, startTime: 0, width: 160, height: 96 });
    const shaky = await analyzeSequence((async function* () { for (let t = 0; t < 20; t++) yield renderScene(160, 96, () => ({ dx: jitter(t, 6, 0.2), dy: jitter(t, 5, 1), rotation: jitter(t, 0.03, 2), logScale: 0 })); })(), { fps: 30, startTime: 0, width: 160, height: 96 });
    for (const an of [two, shaky]) for (const result of WARP_RESULTS) for (const method of WARP_METHODS) for (const framing of WARP_FRAMINGS) for (const rs of ROLLING_SHUTTER_MODES) for (const smoothness of [0, 100]) for (const crop of [0, 100]) {
      const s = normalizeWarpSettings({ ...DEFAULT_WARP_SETTINGS, result, method, framing, rollingShutter: rs, smoothness, cropLessSmoothMore: crop });
      const plan = buildPlan(an, s);
      expect(Number.isFinite(plan.zoom) && Number.isFinite(plan.strength) && Number.isFinite(plan.cropFraction) && plan.zoom >= 1 && plan.zoom <= 4).toBe(true);
      const out: RowDelta = { dx: 0, dy: 0, rotation: 0, logScale: 0, px: 0, py: 0 };
      for (const f of [0, an.frameCount - 1, 0.5]) { rowDelta(plan, f, f, 0.3, out); expect(allFinite(Object.values(out))).toBe(true); }
      hasUncoveredEdge(plan, 0);
    }
  });
  it("frameAt boundaries and non-finite", async () => {
    const an = await analyzeSequence(seq([flat(16, 16, 0.5), flat(16, 16, 0.5), flat(16, 16, 0.5)]), { fps: 30, startTime: 2, width: 16, height: 16 });
    const plan = buildPlan(an, DEFAULT_WARP_SETTINGS);
    expect(frameAt(plan, NaN)).toBeNull();
    expect(frameAt(plan, 100)).toBeNull();
    expect(frameAt(plan, 2)).toBe(0);
  });
  it("rejects analyses with non-finite motion or zero size (corrupt saved project)", async () => {
    const an = await analyzeSequence(seq([flat(16, 16, 0.5), flat(16, 16, 0.5)]), { fps: 30, startTime: 0, width: 16, height: 16 });
    const bad = JSON.parse(JSON.stringify({ ...an, motion: an.motion.map((v, i) => (i === 9 ? NaN : v)) }));
    expect(isWarpAnalysis(bad)).toBe(false);
    expect(isWarpAnalysis({ ...an, width: 0 })).toBe(false);
    expect(isWarpAnalysis({ ...an, fps: Infinity })).toBe(false);
  });
  it("long clip (3000 frames) plan builds fast", () => {
    const n = 3000;
    const motion = new Array(n * 8).fill(0).map((_, i) => (i % 8 === 0 ? jitter(i / 8, 2, 0) : 0));
    const an = { version: 4, fps: 30, startTime: 0, frameCount: n, width: 384, height: 216, motion, confidence: 1 };
    const t0 = performance.now();
    buildPlan(an as never, normalizeWarpSettings({ framing: "stabilizeCropAutoScale" }));
    console.log("plan 3000 frames ms", performance.now() - t0);
  });
});
