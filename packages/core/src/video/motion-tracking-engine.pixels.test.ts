import { describe, expect, it } from "vitest";
import { MotionTrackingEngine, type TrackingFrame } from "./motion-tracking-engine";
import { trackMotionFramePair } from "./motion-frame-tracker";

function frame(dx = 0, dy = 0): TrackingFrame {
  const width = 80, height = 72, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = x - dx, sy = y - dy;
    const texture = sx >= 12 && sx < 60 && sy >= 12 && sy < 60
      ? ((Math.floor(sx / 3) * 73 + Math.floor(sy / 3) * 151 + Math.floor(sx / 3) * Math.floor(sy / 3) * 31) % 211) + 24 : 0;
    const offset = (y * width + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = texture; data[offset + 3] = 255;
  }
  return { width, height, data };
}

const region = { x: 18, y: 18, width: 30, height: 30 };

describe("decoded pixel motion tracking", () => {
  it.each(["correlation", "feature", "optical-flow"] as const)("measures actual translated pixels using %s", async algorithm => {
    const result = await trackMotionFramePair(frame(), frame(3, -2), region, algorithm);
    expect(result.confidence).toBeGreaterThan(.7);
    expect(result.position.x).toBeCloseTo(36, 0);
    expect(result.position.y).toBeCloseTo(31, 0);
    expect(result.scale).toBeCloseTo(1, 1);
    expect(result.rotation).toBeCloseTo(0, 0);
  });

  it("measures small rotation and scale from changed pixels", async () => {
    const before = frame(), after = frame(); after.data.fill(0);
    const angle = 3 * Math.PI / 180, scale = 1.04, center = 33;
    for (let y = 0; y < after.height; y++) for (let x = 0; x < after.width; x++) {
      const dx = (x - center - 2) / scale, dy = (y - center + 1) / scale;
      const sx = Math.round(center + dx * Math.cos(angle) + dy * Math.sin(angle));
      const sy = Math.round(center - dx * Math.sin(angle) + dy * Math.cos(angle));
      if (sx >= 0 && sy >= 0 && sx < before.width && sy < before.height) after.data.set(before.data.subarray((sy * before.width + sx) * 4, (sy * before.width + sx) * 4 + 4), (y * after.width + x) * 4);
    }
    const result = await trackMotionFramePair(before, after, region, "feature");
    expect(result.confidence).toBeGreaterThan(.7); expect(result.position.x).toBeCloseTo(35, 0); expect(result.position.y).toBeCloseTo(32, 0);
    expect(result.scale).toBeGreaterThan(1.015); expect(result.scale).toBeLessThan(1.07);
    expect(result.rotation).toBeGreaterThan(1.5); expect(result.rotation).toBeLessThan(4.5);
  });

  it("marks a lost frame, holds the last measurement and recovers from real texture", async () => {
    const engine = new MotionTrackingEngine(), blank = frame(); blank.data.fill(0);
    const job = await engine.startTracking("clip", region, { endFrame: 2, frameRate: 24 }, async index => index === 1 ? blank : frame(index * 2));
    await engine.waitForTracking(job.id); const data = engine.getTrackingDataForClip("clip")[0];
    expect(data.lostFrames).toEqual([1]); expect(data.keyframes.map(key => Math.round(key.position.x))).toEqual([33, 33, 37]);
  });

  it("maps bounded analysis pixels back to source resolution", async () => {
    const engine = new MotionTrackingEngine();
    const job = await engine.startTracking("clip", { x: 36, y: 36, width: 60, height: 60 }, { endFrame: 1 }, async index => ({ ...frame(index * 2), sourceWidth: 160, sourceHeight: 144 }));
    await engine.waitForTracking(job.id); expect(engine.getTrackingDataForClip("clip")[0].keyframes.map(key => Math.round(key.position.x))).toEqual([66, 70]);
  });

  it("does not invent motion for an untextured image", async () => {
    const blank = frame(); blank.data.fill(0);
    expect((await trackMotionFramePair(blank, blank, region)).confidence).toBe(0);
  });

  it("requires real frame input instead of generating a simulated result", async () => {
    const engine = new MotionTrackingEngine();
    await expect(engine.startTracking("clip", region)).rejects.toThrow("decoded source frames");
    expect(engine.getTrackingDataForClip("clip")).toEqual([]);
  });

  it("records measured source coordinates and actual frame timing", async () => {
    const engine = new MotionTrackingEngine(), requested: number[] = [];
    const job = await engine.startTracking("clip", region, { startFrame: 0, endFrame: 3, frameRate: 24 }, async index => {
      requested.push(index); return frame(index * 2, 0);
    });
    expect((await engine.waitForTracking(job.id)).status).toBe("completed");
    expect(requested).toEqual([0, 1, 2, 3]);
    const result = engine.getTrackingDataForClip("clip")[0];
    expect(result.frameRate).toBe(24);
    expect(result.keyframes.map(key => Math.round(key.position.x))).toEqual([33, 35, 37, 39]);
    expect(result.lostFrames).toEqual([]);
    expect(job.progress).toBe(100);
  });

  it("cancels a pending decode without publishing a result", async () => {
    const engine = new MotionTrackingEngine();
    let finish!: (value: TrackingFrame) => void;
    const pending = new Promise<TrackingFrame>(resolve => { finish = resolve; });
    const job = await engine.startTracking("clip", region, { endFrame: 3 }, () => pending);
    engine.cancelTracking(job.id); finish(frame());
    expect((await engine.waitForTracking(job.id)).status).toBe("cancelled");
    expect(engine.getTrackingDataForClip("clip")).toEqual([]);
  });

  it("fails missing/blank source frames and keeps results out of the data map", async () => {
    const engine = new MotionTrackingEngine();
    const job = await engine.startTracking("clip", region, { endFrame: 1 }, async () => null);
    expect((await engine.waitForTracking(job.id)).error).toContain("decode");
    expect(engine.getTrackingDataForClip("clip")).toEqual([]);
  });
});
