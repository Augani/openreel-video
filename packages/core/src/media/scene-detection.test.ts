import { describe, it, expect } from "vitest";
import {
  computeFrameSignature,
  signatureDistance,
  detectScenes,
  sensitivityToThresholds,
  type FrameLike,
  type FrameSampler,
} from "./scene-detection";

type RGB = readonly [number, number, number];

function solid(color: RGB, w = 16, h = 16): FrameLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const RED: RGB = [220, 30, 30];
const GREEN: RGB = [30, 200, 60];
const BLUE: RGB = [30, 60, 220];
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];

const sampler = (fn: (t: number) => RGB): FrameSampler => async (t) =>
  solid(fn(t));

const base = { startTime: 0, endTime: 10, sampleRate: 5, refine: false };

describe("signatures", () => {
  it("identical frames have zero distance", () => {
    const a = computeFrameSignature(solid(RED));
    expect(signatureDistance(a, computeFrameSignature(solid(RED)))).toBe(0);
  });

  it("different colours are far apart", () => {
    const d = signatureDistance(
      computeFrameSignature(solid(RED)),
      computeFrameSignature(solid(GREEN)),
    );
    expect(d).toBeGreaterThan(0.5);
  });

  it("handles empty frames", () => {
    const sig = computeFrameSignature({ data: [], width: 0, height: 0 });
    expect(signatureDistance(sig, sig)).toBe(0);
  });

  it("sensitivity lowers thresholds", () => {
    const lo = sensitivityToThresholds(0);
    const hi = sensitivityToThresholds(1);
    expect(hi.k).toBeLessThan(lo.k);
    expect(hi.floor).toBeLessThan(lo.floor);
  });
});

describe("detectScenes", () => {
  it("detects hard cuts between solid colours", async () => {
    const s = sampler((t) => (t < 3.3 ? RED : t < 7 ? GREEN : BLUE));
    const res = await detectScenes({ ...base, sampler: s });
    expect(res.cuts).toHaveLength(2);
    expect(res.cuts[0].time).toBeCloseTo(3.4, 1);
    expect(res.cuts[1].time).toBeCloseTo(7, 1);
    expect(res.scenes).toHaveLength(3);
    expect(res.scenes[0].start).toBe(0);
    expect(res.scenes[2].end).toBe(10);
  });

  it("refines cut time to near the true boundary", async () => {
    const s = sampler((t) => (t < 3.33 ? RED : GREEN));
    const res = await detectScenes({ ...base, refine: true, sampler: s });
    expect(res.cuts).toHaveLength(1);
    expect(Math.abs(res.cuts[0].time - 3.33)).toBeLessThan(0.06);
  });

  it("finds nothing in a static clip", async () => {
    const res = await detectScenes({ ...base, sampler: sampler(() => RED) });
    expect(res.cuts).toHaveLength(0);
    expect(res.scenes).toEqual([{ start: 0, end: 10 }]);
  });

  it("does not trigger on a gradual fade", async () => {
    const s = sampler((t) =>
      t < 3 ? RED : t < 7 ? lerp(RED, BLACK, (t - 3) / 4) : BLACK,
    );
    const res = await detectScenes({ ...base, sampler: s });
    expect(res.cuts).toHaveLength(0);
  });

  it("does not trigger on a gradual cross-dissolve", async () => {
    const s = sampler((t) =>
      t < 3 ? RED : t < 7 ? lerp(RED, BLUE, (t - 3) / 4) : BLUE,
    );
    const res = await detectScenes({ ...base, sampler: s });
    expect(res.cuts).toHaveLength(0);
  });

  it("suppresses a short flash", async () => {
    const s = sampler((t) => (t >= 5 && t < 5.25 ? WHITE : RED));
    const res = await detectScenes({ ...base, sampler: s });
    expect(res.cuts).toHaveLength(0);
  });

  it("keeps a real cut when a short flash occurs later in the new scene", async () => {
    const s = sampler((t) =>
      t < 3 ? RED : t >= 6 && t < 6.2 ? WHITE : GREEN,
    );
    const res = await detectScenes({ ...base, sampler: s });
    expect(res.cuts).toHaveLength(1);
    expect(res.cuts[0].time).toBeCloseTo(3, 1);
  });

  it("suppresses cuts closer than the minimum scene length", async () => {
    const s = sampler((t) => (t < 4 ? RED : t < 4.4 ? GREEN : BLUE));
    const res = await detectScenes({
      ...base,
      minSceneLength: 1,
      sampler: s,
    });
    expect(res.cuts).toHaveLength(1);
  });

  it("allows closer cuts with a smaller minimum scene length", async () => {
    const s = sampler((t) => (t < 4 ? RED : t < 4.6 ? GREEN : BLUE));
    const res = await detectScenes({
      ...base,
      minSceneLength: 0.4,
      sampler: s,
    });
    expect(res.cuts).toHaveLength(2);
  });

  it("higher sensitivity catches subtler cuts", async () => {
    const subtle: RGB = [200, 60, 50];
    const s = sampler((t) => (t < 5 ? RED : subtle));
    const strict = await detectScenes({ ...base, sensitivity: 0, sampler: s });
    const loose = await detectScenes({ ...base, sensitivity: 1, sampler: s });
    expect(loose.cuts.length).toBeGreaterThanOrEqual(strict.cuts.length);
  });

  it("honours a non-zero source range", async () => {
    const s = sampler((t) => (t < 12 ? RED : GREEN));
    const res = await detectScenes({
      ...base,
      startTime: 10,
      endTime: 20,
      sampler: s,
    });
    expect(res.cuts).toHaveLength(1);
    expect(res.cuts[0].time).toBeCloseTo(12, 1);
  });

  it("skips frames the sampler cannot provide", async () => {
    const s: FrameSampler = async (t) =>
      t > 4.9 && t < 5.1 ? null : solid(t < 5 ? RED : GREEN);
    const res = await detectScenes({ ...base, sampler: s });
    expect(res.cuts).toHaveLength(1);
  });

  it("reports progress up to 1", async () => {
    const fractions: number[] = [];
    await detectScenes({
      ...base,
      sampler: sampler(() => RED),
      onProgress: (p) => fractions.push(p.fraction),
    });
    expect(fractions.length).toBeGreaterThan(10);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);
  });

  it("aborts via AbortSignal", async () => {
    const controller = new AbortController();
    let calls = 0;
    const s: FrameSampler = async () => {
      calls++;
      if (calls === 5) controller.abort();
      return solid(RED);
    };
    await expect(
      detectScenes({ ...base, sampler: s, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBeLessThan(10);
  });

  it("rejects when aborted during the final sample instead of returning stale results", async () => {
    const controller = new AbortController();
    const total = Math.floor((base.endTime - base.startTime) * 5) + 1;
    let calls = 0;
    const s: FrameSampler = async () => {
      calls++;
      if (calls === total) controller.abort();
      return solid(RED);
    };
    await expect(
      detectScenes({ ...base, sampler: s, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects immediately when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      detectScenes({
        ...base,
        sampler: sampler(() => RED),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns empty for an empty range", async () => {
    const res = await detectScenes({
      ...base,
      endTime: 0,
      sampler: sampler(() => RED),
    });
    expect(res.cuts).toEqual([]);
    expect(res.scenes).toEqual([]);
  });
});
