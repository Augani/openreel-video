import { describe, expect, it } from "vitest";
import { applyHomography, invertHomography, seededRandom, type Homography, type Quad } from "./planar-homography";
import { PlanarTrackSession, trackPlanarSurface, type PlanarSessionFrame } from "./planar-track";

/**
 * Ground-truth accuracy of the planar tracker: a textured plane flies through 64 frames of perspective motion
 * over a different background, with sensor noise and a moving occluder that hides part of it. The true corners of
 * every frame are known exactly (they come from the homography that rendered the frame).
 */
const W = 320, H = 240, FRAMES = 64;
const SURFACE: Quad = [{ x: 80, y: 60 }, { x: 240, y: 60 }, { x: 240, y: 180 }, { x: 80, y: 180 }];

function valueNoise(seed: number, cell: number): (x: number, y: number) => number {
  const rand = seededRandom(seed), size = 96, grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const at = (i: number, j: number) => grid[((j % size + size) % size) * size + ((i % size + size) % size)];
  return (x, y) => {
    const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
}
const fine = valueNoise(11, 3), coarse = valueNoise(12, 9), back = valueNoise(99, 6);
const texture = (x: number, y: number) => 30 + 150 * fine(x, y) + 70 * coarse(x, y);

/** The plane's pose at frame t: smooth translation, rotation, zoom and growing perspective. */
function pose(t: number): Homography {
  const a = Math.sin(t / 20) * 0.12, k = 1 + 0.12 * Math.sin(t / 25), c = Math.cos(a) * k, s = Math.sin(a) * k;
  const cx = 160, cy = 120, tx = 25 * Math.sin(t / 13), ty = 14 * Math.sin(t / 9 + 1);
  return [c, -s, cx + tx - c * cx + s * cy, s, c, cy + ty - s * cx - c * cy, 0.00035 * Math.sin(t / 11), 0.0003 * Math.sin(t / 17), 1];
}
const truth = (t: number): number[] => SURFACE.flatMap((p) => { const q = applyHomography(pose(t), p); return [q.x, q.y]; });

function render(t: number, noise: number, occlude: boolean): PlanarSessionFrame {
  const inv = invertHomography(pose(t))!, data = new Uint8ClampedArray(W * H * 4), rand = seededRandom(1000 + t);
  // The occluder: a flat box sliding across the right side of the surface for frames 18..44.
  const ox = 250 - (t - 18) * 4.5, oy = 70 + (t - 18) * 1.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = applyHomography(inv, { x: x + 0.5, y: y + 0.5 });
    const inside = s.x >= SURFACE[0].x && s.x <= SURFACE[1].x && s.y >= SURFACE[0].y && s.y <= SURFACE[2].y;
    let v = inside ? texture(s.x, s.y) : 25 + 90 * back(x * 0.5, y * 0.5);
    if (occlude && t >= 18 && t <= 44 && x > ox && x < ox + 50 && y > oy && y < oy + 60) v = 200;
    v += (rand() + rand() + rand() - 1.5) * 2 * noise;
    const o = (y * W + x) * 4; data[o] = data[o + 1] = data[o + 2] = Math.max(0, Math.min(255, v)); data[o + 3] = 255;
  }
  return { width: W, height: H, data };
}

async function run(noise: number, occlude: boolean): Promise<{ worst: number; mean: number; lost: number; confidence: number[] }> {
  const session = new PlanarTrackSession({ corners: truth(0) });
  const errs: number[] = [], conf: number[] = []; let lost = 0;
  for (let t = 0; t < FRAMES; t++) {
    const step = await session.step(render(t, noise, occlude));
    const want = truth(t);
    errs.push(Math.max(...[0, 1, 2, 3].map((i) => Math.hypot(want[i * 2] - step.corners[i * 2], want[i * 2 + 1] - step.corners[i * 2 + 1]))));
    conf.push(step.confidence); if (step.lost) lost++;
  }
  return { worst: Math.max(...errs), mean: errs.reduce((a, b) => a + b, 0) / errs.length, lost, confidence: conf };
}

describe("planar tracker accuracy (ground truth, 64 frames)", () => {
  it("noisy footage with a moving occluder stays under 1 px at every corner", async () => {
    const r = await run(6, true);
    console.log(`[planar accuracy] noise+occlusion: worst ${r.worst.toFixed(3)} px mean ${r.mean.toFixed(3)} px lost ${r.lost}`);
    expect(r.lost).toBe(0);
    expect(r.worst).toBeLessThan(1);
    expect(Math.min(...r.confidence)).toBeGreaterThan(0.5);
  }, 240000);

  it("clean footage is accurate to a fraction of a pixel", async () => {
    const r = await run(0, false);
    console.log(`[planar accuracy] clean: worst ${r.worst.toFixed(3)} px mean ${r.mean.toFixed(3)} px`);
    expect(r.worst).toBeLessThan(0.5);
  }, 240000);

  it("heavy noise (sigma ~ 14 grey levels) with the occluder stays under 1 px", async () => {
    const r = await run(14, true);
    console.log(`[planar accuracy] heavy noise: worst ${r.worst.toFixed(3)} px mean ${r.mean.toFixed(3)} px lost ${r.lost}`);
    expect(r.lost).toBe(0);
    expect(r.worst).toBeLessThan(1);
  }, 240000);

  it("tracks backward from the last frame over the whole clip within 1 px", async () => {
    const frames = new Map<number, PlanarSessionFrame>();
    const read = async (f: number) => { if (!frames.has(f)) frames.set(f, render(f, 6, true)); const src = frames.get(f)!; return { ...src, data: new Uint8ClampedArray(src.data) }; };
    const data = await trackPlanarSurface({ clipId: "c", frameRate: 30, anchorFrame: FRAMES - 1, startFrame: 0, endFrame: FRAMES - 1, direction: "backward", corners: truth(FRAMES - 1), readFrame: read });
    expect(data.keyframes).toHaveLength(FRAMES);
    const worst = Math.max(...data.keyframes.map((k) => { const want = truth(k.frame); return Math.max(...[0, 1, 2, 3].map((i) => Math.hypot(want[i * 2] - k.corners[i * 2], want[i * 2 + 1] - k.corners[i * 2 + 1]))); }));
    console.log(`[planar accuracy] backward: worst ${worst.toFixed(3)} px`);
    expect(worst).toBeLessThan(1);
    expect(data.lostFrames).toEqual([]);
  }, 240000);

  it("reports low confidence and holds the corners when the surface is fully covered", async () => {
    const session = new PlanarTrackSession({ corners: truth(0) });
    let before: number[] = [];
    for (let t = 0; t < 10; t++) before = (await session.step(render(t, 4, false))).corners;
    const cover = render(10, 4, false);
    for (let i = 0; i < cover.data.length; i += 4) cover.data[i] = cover.data[i + 1] = cover.data[i + 2] = 90;
    const gone = await session.step(cover);
    expect(gone.lost).toBe(true);
    expect(gone.corners).toEqual(before);
    // ...and it re-acquires when the surface returns.
    const back = await session.step(render(11, 4, false));
    expect(back.lost).toBe(false);
    const want = truth(11);
    expect(Math.max(...[0, 1, 2, 3].map((i) => Math.hypot(want[i * 2] - back.corners[i * 2], want[i * 2 + 1] - back.corners[i * 2 + 1])))).toBeLessThan(1.5);
  }, 120000);
});
