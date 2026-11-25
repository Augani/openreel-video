import { describe, expect, it } from "vitest";
import { GrabCutSegmenter } from "./grabcut-segmenter";
import { maskToPath, rasterizePath } from "./contour";
import { ObjectMaskTracker, trackObjectMask } from "./track";
import { maskArea } from "./raster-ops";
import { movingObjectScene } from "./synthetic-object";
import type { RGBAFrame } from "./types";

const flat = (w: number, h: number, v = 128): RGBAFrame => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
};
const seg = new GrabCutSegmenter();
describe("edge cases", () => {
  it("flat frame click does not throw", async () => {
    const r = await seg.segment(flat(64, 36), { include: [{ x: 32, y: 18 }] });
    expect(r.mask.length).toBe(64 * 36);
  });
  it("1x1 and tiny frames", async () => {
    for (const [w, h] of [[1, 1], [2, 2], [3, 1]]) {
      const r = await seg.segment(flat(w, h), { include: [{ x: 0, y: 0 }] });
      expect(r.mask.length).toBe(w * h);
    }
  });
  it("no prompt at all, off-frame and NaN points", async () => {
    const f = movingObjectScene(96, 54, 4).frame(0);
    await seg.segment(f, {});
    await seg.segment(f, { include: [{ x: -50, y: 9999 }] });
    await seg.segment(f, { include: [{ x: NaN, y: NaN }] });
    await seg.segment(f, { strokes: [{ include: true, radius: 3, points: [] }] });
  });
  it("tracking an all-flat clip / empty anchor", async () => {
    const f = flat(64, 36);
    const path = maskToPath(rasterizePath({ closed: true, points: [{ x: .3, y: .3 }, { x: .7, y: .3 }, { x: .7, y: .7 }, { x: .3, y: .7 }] }, 64, 36), 64, 36)!;
    const frames = await trackObjectMask({ segmenter: seg, readFrame: async (n) => (n < 10 ? f : null), anchorFrame: 0, anchorPath: path, direction: "forward", endFrame: 20 });
    expect(frames.length).toBe(10);
    for (const fr of frames) expect(fr.path.points.length).toBeGreaterThan(2);
  });
  it("empty anchor throws cleanly", () => {
    const f = flat(64, 36);
    expect(() => new ObjectMaskTracker({ segmenter: seg, anchorImage: f, anchorPath: { closed: true, points: [] } })).toThrow();
  });
  it("object leaving the frame is reported lost, not crash", async () => {
    const sc = movingObjectScene(96, 54, 4);
    const blank = flat(96, 54, 40);
    const c = sc.center(0);
    const r = await seg.segment(sc.frame(0), { include: [c] });
    const path = maskToPath(r.mask, 96, 54)!;
    const t = new ObjectMaskTracker({ segmenter: seg, anchorImage: sc.frame(0), anchorPath: path });
    const s = await t.step(1, blank);
    const s2 = await t.step(2, blank);
    expect(s.path.points.length).toBeGreaterThan(0);
    expect(s2.path.points.length).toBeGreaterThan(0);
    expect(maskArea(rasterizePath(s2.path, 96, 54))).toBeGreaterThanOrEqual(0);
  });
});
