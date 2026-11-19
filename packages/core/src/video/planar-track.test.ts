import { describe, expect, it } from "vitest";
import { applyHomography, invertHomography, seededRandom, type Homography, type Quad } from "./planar-homography";
import {
  correctPlanarFrame, cornersToQuad, mergePlanarTrack, planarCornersAt, PlanarTrackSession, trackPlanarSurface, type PlanarSessionFrame,
} from "./planar-track";

const W = 200, H = 150;
/** A smooth-ish seeded texture sampled bilinearly, so warped frames carry real sub-pixel structure. */
function texture(seed: number): (x: number, y: number) => number {
  const rand = seededRandom(seed), size = 128, cells = new Float32Array(size * size);
  for (let i = 0; i < cells.length; i++) cells[i] = rand() * 255;
  const at = (x: number, y: number) => cells[((y % size + size) % size) * size + ((x % size + size) % size)];
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
}
const tex = texture(42);
const SURFACE: Quad = [{ x: 50, y: 40 }, { x: 150, y: 40 }, { x: 150, y: 110 }, { x: 50, y: 110 }];

/** Frame t: the surface moves by `world(t)` (a homography on the plane); the background is a different texture. */
function render(world: Homography): PlanarSessionFrame {
  const inv = invertHomography(world)!, bg = texture(99), data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = applyHomography(inv, { x, y });
    const inside = s.x >= 50 && s.x <= 150 && s.y >= 40 && s.y <= 110;
    const v = inside ? tex(s.x, s.y) : bg(x * 0.5, y * 0.5) * 0.3 + 40;
    const o = (y * W + x) * 4; data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
  return { width: W, height: H, data };
}
const motion = (t: number): Homography => {
  const a = t * 0.01, c = Math.cos(a), s = Math.sin(a), tx = t * 1.3, ty = t * 0.6, k = 1 + t * 0.004;
  return [k * c, -k * s, tx + 100 * (1 - k * c) + 75 * k * s - 100 * 0 , k * s, k * c, ty + 75 * (1 - k * c) - 100 * k * s, 0.00003 * t, 0, 1];
};
const truthCorners = (t: number) => SURFACE.map(p => applyHomography(motion(t), p));
const err = (corners: number[], t: number) => Math.max(...truthCorners(t).map((p, i) => Math.hypot(p.x - corners[i * 2], p.y - corners[i * 2 + 1])));

describe("PlanarTrackSession", () => {
  it("tracks a moving, rotating, perspective-skewed surface through clutter", async () => {
    const session = new PlanarTrackSession({ corners: SURFACE.flatMap(p => [p.x, p.y]) });
    let worst = 0;
    for (let t = 0; t <= 14; t++) {
      const step = await session.step(render(motion(t)));
      expect(step.status).toBe("tracked");
      worst = Math.max(worst, err(step.corners, t));
    }
    expect(worst).toBeLessThan(2);
  }, 30000);

  it("is deterministic", async () => {
    const run = async () => { const s = new PlanarTrackSession({ corners: SURFACE.flatMap(p => [p.x, p.y]) }); const out: number[][] = []; for (let t = 0; t < 5; t++) out.push((await s.step(render(motion(t)))).corners); return out; };
    expect(await run()).toEqual(await run());
  }, 30000);

  it("rejects a textureless surface and a flipped quad", async () => {
    const flat: PlanarSessionFrame = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(128) };
    await expect(new PlanarTrackSession({ corners: SURFACE.flatMap(p => [p.x, p.y]) }).step(flat)).rejects.toThrow(/detail/);
    await expect(new PlanarTrackSession({ corners: [50, 40, 150, 110, 150, 40, 50, 110] }).step(render(motion(0)))).rejects.toThrow(/corners/);
  });

  it("holds the last corners and reports lost when the surface vanishes", async () => {
    const session = new PlanarTrackSession({ corners: SURFACE.flatMap(p => [p.x, p.y]) });
    await session.step(render(motion(0)));
    const before = (await session.step(render(motion(1)))).corners;
    const blank: PlanarSessionFrame = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(60) };
    const gone = await session.step(blank);
    expect(gone.lost).toBe(true);
    expect(gone.status).toBe("predicted");
    expect(gone.corners).toEqual(before);
  }, 30000);
});

describe("trackPlanarSurface", () => {
  const frames = new Map<number, PlanarSessionFrame>();
  const read = async (f: number) => { if (!frames.has(f)) frames.set(f, render(motion(f))); const src = frames.get(f)!; return { ...src, data: new Uint8ClampedArray(src.data) }; };
  const base = { clipId: "c", frameRate: 30, startFrame: 0, endFrame: 8, readFrame: read };

  it("tracks forward and reports progress", async () => {
    const progress: number[] = [];
    const data = await trackPlanarSurface({ ...base, anchorFrame: 0, corners: SURFACE.flatMap(p => [p.x, p.y]), onProgress: p => progress.push(p) });
    expect(data.keyframes.map(k => k.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(progress.at(-1)).toBe(100);
    expect(err(data.keyframes[8].corners, 8)).toBeLessThan(2);
  }, 60000);

  it("tracks backward from a later anchor frame", async () => {
    const corners = truthCorners(8).flatMap(p => [p.x, p.y]);
    const data = await trackPlanarSurface({ ...base, anchorFrame: 8, direction: "backward", corners });
    expect(data.keyframes.map(k => k.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(err(data.keyframes[0].corners, 0)).toBeLessThan(2.5);
  }, 60000);

  it("cancels through an AbortSignal", async () => {
    const controller = new AbortController();
    const run = trackPlanarSurface({ ...base, anchorFrame: 0, corners: SURFACE.flatMap(p => [p.x, p.y]), signal: controller.signal, onProgress: p => { if (p > 20) controller.abort(); } });
    await expect(run).rejects.toThrow(/cancelled/);
  }, 60000);
});

describe("planar track data", () => {
  const data = { version: 1 as const, trackId: "t", clipId: "c", frameRate: 30, anchorFrame: 0, anchorCorners: [0, 0, 1, 0, 1, 1, 0, 1],
    keyframes: [0, 10, 20].map(f => ({ frame: f, corners: Array.from({ length: 8 }, (_, i) => i + f) })), confidence: [1, 0.9, 0.2], lostFrames: [20], manualFrames: [] };

  it("interpolates corners between samples", () => {
    const at = planarCornersAt(data, 5)!;
    expect(at.corners[0]).toBeCloseTo(5);
    expect(at.exact).toBe(false);
    expect(planarCornersAt(data, 10)!.exact).toBe(true);
    expect(planarCornersAt({ ...data, keyframes: [], confidence: [] }, 3)).toBeNull();
  });

  it("applies a manual correction and clears the lost flag", () => {
    const fixed = correctPlanarFrame(data, 20, [9, 9, 9, 9, 9, 9, 9, 9]);
    expect(fixed.lostFrames).toEqual([]);
    expect(fixed.manualFrames).toEqual([20]);
    expect(fixed.confidence[2]).toBe(1);
    const added = correctPlanarFrame(data, 15, [1, 1, 1, 1, 1, 1, 1, 1]);
    expect(added.keyframes.map(k => k.frame)).toEqual([0, 10, 15, 20]);
    expect(() => correctPlanarFrame(data, -1, [1, 1, 1, 1, 1, 1, 1, 1])).toThrow();
  });

  it("merges a partial re-track over the covered frames only", () => {
    const incoming = { ...data, keyframes: [{ frame: 10, corners: Array(8).fill(99) }, { frame: 20, corners: Array(8).fill(98) }], confidence: [1, 1], lostFrames: [] };
    const merged = mergePlanarTrack(data, incoming);
    expect(merged.keyframes.map(k => k.frame)).toEqual([0, 10, 20]);
    expect(merged.keyframes[0].corners[0]).toBe(0);
    expect(merged.keyframes[1].corners[0]).toBe(99);
    expect(merged.lostFrames).toEqual([]);
    expect(cornersToQuad([1, 2, 3, 4, 5, 6, 7, 8])[2]).toEqual({ x: 5, y: 6 });
  });
});
