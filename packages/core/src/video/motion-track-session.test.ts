import { describe, expect, it } from "vitest";
import { MotionTrackingEngine, type TrackingFrame } from "./motion-tracking-engine";
import { refineSubpixel } from "./motion-frame-tracker";
import { MotionTrackSession } from "./motion-track-session";
import { mergeTrackingData, correctTrackingFrame, trackQualityRuns, trackingPointAt } from "./motion-track-data";

const W = 200, H = 120, SIZE = 32;

/** Textured background with a distinct textured sprite centred on `at`; `occlude` paints a flat box over it. */
function scene(at: { x: number; y: number }, occlude?: { x: number; y: number; w: number; h: number }): TrackingFrame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const background = 60 + ((x * 7 + y * 13 + ((x * y) % 17) * 5) % 41);
    const sx = x - (at.x - SIZE / 2), sy = y - (at.y - SIZE / 2);
    const sprite = sx >= 0 && sy >= 0 && sx < SIZE && sy < SIZE;
    let value = background;
    if (sprite) value = 30 + ((Math.floor(sx / 2) * 73 + Math.floor(sy / 2) * 151 + Math.floor(sx / 2) * Math.floor(sy / 2) * 31) % 197);
    if (occlude && x >= occlude.x && y >= occlude.y && x < occlude.x + occlude.w && y < occlude.y + occlude.h) value = 200;
    const o = (y * W + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = value; data[o + 3] = 255;
  }
  return { width: W, height: H, data };
}

const pathAt = (frame: number) => ({ x: 40 + frame * 3, y: 60 + Math.round(10 * Math.sin(frame / 6)) });
const region = { x: 40 - SIZE / 2, y: 60 - SIZE / 2, width: SIZE, height: SIZE };

describe("MotionTrackSession", () => {
  it("follows a moving target within a pixel and reports high confidence", async () => {
    const session = new MotionTrackSession({ region });
    for (let frame = 0; frame < 30; frame++) {
      const step = await session.step(scene(pathAt(frame)));
      expect(Math.hypot(step.position.x - pathAt(frame).x, step.position.y - pathAt(frame).y)).toBeLessThanOrEqual(1.5);
      expect(step.confidence).toBeGreaterThan(0.7);
      expect(step.status).toBe("tracked");
    }
  });

  it("predicts through a full occlusion, marks the frames low confidence and re-acquires when the target returns", async () => {
    const session = new MotionTrackSession({ region });
    const steps = [];
    for (let frame = 0; frame < 40; frame++) {
      const hidden = frame >= 12 && frame < 20;
      const at = pathAt(frame);
      // Cover the whole target (and a margin) with a flat box while hidden.
      steps.push(await session.step(scene(at, hidden ? { x: at.x - 40, y: at.y - 40, w: 80, h: 80 } : undefined)));
    }
    for (let frame = 12; frame < 20; frame++) {
      expect(steps[frame].lost, `frame ${frame} lost`).toBe(true);
      expect(steps[frame].status).toBe("predicted");
      expect(steps[frame].confidence).toBeLessThan(0.7);
    }
    const back = steps[20];
    expect(back.status).toBe("reacquired");
    expect(Math.hypot(back.position.x - pathAt(20).x, back.position.y - pathAt(20).y)).toBeLessThanOrEqual(2);
    for (let frame = 22; frame < 40; frame++) {
      expect(Math.hypot(steps[frame].position.x - pathAt(frame).x, steps[frame].position.y - pathAt(frame).y)).toBeLessThanOrEqual(2);
    }
    // Velocity prediction keeps the hidden frames near the real path instead of freezing at the last point.
    expect(Math.abs(steps[16].position.x - pathAt(16).x)).toBeLessThan(Math.abs(steps[11].position.x - pathAt(16).x));
  });

  it("keeps tracking through partial occlusion", async () => {
    const session = new MotionTrackSession({ region });
    for (let frame = 0; frame < 25; frame++) {
      const at = pathAt(frame);
      const covered = frame >= 8 && frame < 16 ? { x: at.x, y: at.y - SIZE / 2, w: SIZE / 2, h: SIZE } : undefined;
      const step = await session.step(scene(at, covered));
      expect(Math.hypot(step.position.x - at.x, step.position.y - at.y)).toBeLessThanOrEqual(3);
    }
  });

  it("catches a fast jump beyond the normal search window", async () => {
    const session = new MotionTrackSession({ region });
    const positions = [{ x: 40, y: 60 }, { x: 46, y: 60 }, { x: 52, y: 60 }, { x: 58, y: 60 }, { x: 118, y: 62 }, { x: 124, y: 62 },
      // ...then the burst ends and the target turns back while the velocity estimate still points forward.
      { x: 150, y: 62 }, { x: 148, y: 62 }, { x: 146, y: 63 }];
    const results = [];
    for (const at of positions) results.push(await session.step(scene(at)));
    expect(Math.hypot(results[4].position.x - 118, results[4].position.y - 62)).toBeLessThanOrEqual(2);
    expect(results[5].position.x).toBeGreaterThan(120);
    for (const [index, at] of positions.entries()) expect(Math.hypot(results[index].position.x - at.x, results[index].position.y - at.y), `frame ${index}`).toBeLessThanOrEqual(2);
  });

  it("refuses a flat region", async () => {
    const flat: TrackingFrame = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(90) };
    await expect(new MotionTrackSession({ region }).step(flat)).rejects.toThrow(/textured/);
  });
});

describe("engine tracking directions", () => {
  it("tracks backward from an anchor frame and stores frames ascending", async () => {
    const engine = new MotionTrackingEngine();
    const anchor = 20;
    const anchorRegion = { x: pathAt(anchor).x - SIZE / 2, y: pathAt(anchor).y - SIZE / 2, width: SIZE, height: SIZE };
    const job = await engine.startTracking("clip", anchorRegion, { startFrame: 10, endFrame: anchor, direction: "backward", frameRate: 30 }, async frame => scene(pathAt(frame)));
    await engine.waitForTracking(job.id);
    const data = engine.getTrackingDataForClip("clip")[0];
    expect(data.keyframes.map(key => key.frame)).toEqual(Array.from({ length: 11 }, (_, index) => 10 + index));
    for (const key of data.keyframes) expect(Math.hypot(key.position.x - pathAt(key.frame).x, key.position.y - pathAt(key.frame).y)).toBeLessThanOrEqual(1.5);
    expect(data.stats?.frames).toBe(11);
    expect(data.states?.every(state => state === "tracked")).toBe(true);
  });

  it("reads the next frame while the tracker works and stops when cancelled", async () => {
    const engine = new MotionTrackingEngine();
    const log: string[] = [];
    const job = await engine.startTracking("clip", region, { endFrame: 40 }, async frame => { log.push(`read${frame}`); return scene(pathAt(frame)); });
    engine.cancelTracking(job.id);
    const finished = await engine.waitForTracking(job.id);
    expect(finished.status).toBe("cancelled");
    expect(log.length).toBeLessThan(10);
  });
});

describe("tracking data edits", () => {
  const base = () => ({
    trackId: "t", clipId: "c", frameRate: 30, region,
    keyframes: [0, 1, 2, 3, 4].map(frame => ({ frame, position: { x: frame * 10, y: 5 }, scale: 1, rotation: 0 })),
    confidence: [1, 1, 0.1, 0.1, 1], lostFrames: [2, 3], states: ["tracked", "tracked", "predicted", "predicted", "tracked"] as const,
  });

  it("merges a partial re-track over only the frames it covered", () => {
    const incoming = { ...base(), keyframes: [2, 3].map(frame => ({ frame, position: { x: frame * 10 + 1, y: 7 }, scale: 1, rotation: 0 })), confidence: [0.9, 0.9], lostFrames: [], states: ["tracked", "tracked"] as const };
    const merged = mergeTrackingData({ ...base(), states: [...base().states] }, { ...incoming, states: [...incoming.states] });
    expect(merged.keyframes.map(key => key.position.x)).toEqual([0, 10, 21, 31, 40]);
    expect(merged.lostFrames).toEqual([]);
    expect(merged.confidence).toEqual([1, 1, 0.9, 0.9, 1]);
  });

  it("applies a manual correction without mutating the original and clears the lost mark", () => {
    const original = { ...base(), states: [...base().states] };
    const fixed = correctTrackingFrame(original, 2, { x: 99, y: 11 });
    expect(original.keyframes[2].position.x).toBe(20);
    expect(fixed.keyframes[2].position).toEqual({ x: 99, y: 11 });
    expect(fixed.confidence[2]).toBe(1);
    expect(fixed.lostFrames).toEqual([3]);
    expect(fixed.manualFrames).toEqual([2]);
    expect(trackQualityRuns(fixed)).toEqual([{ start: 3, end: 3, kind: "lost" }]);
  });

  it("interpolates between samples for a frame in a gap", () => {
    const point = trackingPointAt({ ...base(), keyframes: [base().keyframes[0], base().keyframes[4]], confidence: [1, 1], states: ["tracked", "tracked"] }, 2);
    expect(point?.position.x).toBeCloseTo(20);
    expect(point?.exact).toBe(false);
  });
});

describe("tracking drift", () => {
  it("refines an integer score peak to a sub-pixel position and ignores edge or flat peaks", () => {
    // Parabola through (-1: .6, 0: 1, +1: .8) peaks 0.125 px toward +1... (minus - plus) / (2 * (minus - 2c + plus)).
    const surface = (dx: number, dy: number) => 1 - 0.4 * (dx - 0.2) ** 2 - 0.4 * (dy + 0.3) ** 2;
    const fine = refineSubpixel(surface(0, 0), (dx, dy) => surface(dx, dy));
    expect(fine.x).toBeCloseTo(0.2, 5);
    expect(fine.y).toBeCloseTo(-0.3, 5);
    expect(refineSubpixel(1, () => 1)).toEqual({ x: 0, y: 0 });
    expect(refineSubpixel(0.5, (dx) => (dx === 1 ? 0.9 : 0.4))).toEqual({ x: 0, y: 0 });
  });

  it("stays within 2 px of a slowly moving target over 80 frames, including a re-track from the middle", async () => {
    const at = (frame: number) => ({ x: 40 + Math.round(frame * 1.2), y: 60 + Math.round(12 * Math.sin(frame / 14)) });
    const cover = (frame: number) => (frame >= 34 && frame < 42 ? { x: at(frame).x - SIZE / 2 - 2, y: at(frame).y - SIZE / 2 - 2, w: 14, h: SIZE + 4 } : undefined);
    const run = async (start: number, from: { x: number; y: number }) => {
      const session = new MotionTrackSession({ region: { x: from.x - 12, y: from.y - 12, width: 24, height: 24 } });
      const out: Array<{ x: number; y: number }> = [];
      for (let frame = start; frame < 80; frame++) out.push((await session.step(scene(at(frame), cover(frame)))).position);
      return out;
    };
    const worst = (path: Array<{ x: number; y: number }>, start: number) => Math.max(...path.map((p, i) => Math.hypot(p.x - at(start + i).x, p.y - at(start + i).y)));
    const forward = await run(0, at(0));
    expect(worst(forward, 0)).toBeLessThanOrEqual(2);
    // Re-track from a point that carries the first track's small error: it must not add drift of its own.
    const retrack = await run(50, forward[50]);
    expect(worst(retrack, 50)).toBeLessThanOrEqual(2);
  });
});
