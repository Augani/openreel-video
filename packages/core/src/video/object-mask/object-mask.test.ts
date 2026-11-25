import { describe, expect, it } from "vitest";
import { maskPathAtTime, type BezierPath, type Mask } from "../mask-engine";
import { editMaskPathAtTime } from "../mask-path";
import { maskToPath, rasterizePath } from "./contour";
import { GrabCutSegmenter } from "./grabcut-segmenter";
import { mergeTrackedKeyframes, trackedFramesToKeyframes } from "./keyframes";
import { applyMaskLook, growMask, maskArea, maskIoU } from "./raster-ops";
import { movingObjectScene } from "./synthetic-object";
import { trackObjectMask, type ObjectTrackFrame } from "./track";
import type { ObjectSegmenter, RGBAFrame, SegmentPrompt } from "./types";

const FRAMES = 60;
const scene = movingObjectScene(192, 108, FRAMES);
const W = scene.width;
const H = scene.height;
const segmenter = new GrabCutSegmenter();

async function clickPath(): Promise<BezierPath> {
  const c = scene.center(0);
  const result = await segmenter.segment(scene.frame(0), { include: [{ x: c.x, y: c.y }] });
  const path = maskToPath(result.mask, W, H);
  if (!path) throw new Error("no outline");
  return path;
}

describe("one-click segmentation", () => {
  it("cuts a synthetic object out of a textured background (IoU >= 0.85)", async () => {
    const c = scene.center(0);
    const result = await segmenter.segment(scene.frame(0), { include: [{ x: c.x, y: c.y }] });
    expect(maskIoU(result.mask, scene.truth(0))).toBeGreaterThanOrEqual(0.85);
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it("an exclude click removes a region the cut leaked into", async () => {
    const c = scene.center(0);
    const base = await segmenter.segment(scene.frame(0), { include: [{ x: c.x, y: c.y }] });
    // Exclude the left half of the object: the cut must not contain the excluded point.
    const ex = { x: c.x - 18, y: c.y };
    const cut = await segmenter.segment(scene.frame(0), { include: [{ x: c.x + 10, y: c.y }], exclude: [ex] });
    expect(base.mask[Math.round(ex.y) * W + Math.round(ex.x)]).toBe(1);
    expect(cut.mask[Math.round(ex.y) * W + Math.round(ex.x)]).toBe(0);
  });

  it("a brush stroke selects the object as well", async () => {
    const c = scene.center(0);
    const result = await segmenter.segment(scene.frame(0), {
      strokes: [{ include: true, radius: 3, points: [{ x: c.x - 8, y: c.y }, { x: c.x + 8, y: c.y + 2 }] }],
    });
    expect(maskIoU(result.mask, scene.truth(0))).toBeGreaterThanOrEqual(0.85);
  });

  it("is deterministic and replaceable behind the ObjectSegmenter interface", async () => {
    const a = await segmenter.segment(scene.frame(0), { include: [scene.center(0)] });
    const b = await segmenter.segment(scene.frame(0), { include: [scene.center(0)] });
    expect(maskIoU(a.mask, b.mask)).toBe(1);
    const stub: ObjectSegmenter = {
      id: "stub-ml",
      segment: (image: RGBAFrame, prompt: SegmentPrompt) => ({ width: image.width, height: image.height, mask: prompt.prior ?? new Uint8Array(image.width * image.height), confidence: 1 }),
    };
    const tracked = await trackObjectMask({
      segmenter: stub,
      readFrame: async (f) => scene.frame(f),
      anchorFrame: 0,
      anchorPath: await clickPath(),
      direction: "forward",
      endFrame: 2,
    });
    expect(tracked).toHaveLength(3);
  });
});

describe("outline path", () => {
  it("round-trips a mask through an editable path with the same vertex count", async () => {
    const truth = scene.truth(0);
    const path = maskToPath(truth, W, H)!;
    expect(path.points).toHaveLength(32);
    expect(maskIoU(rasterizePath(path, W, H), truth)).toBeGreaterThan(0.93);
    const other = maskToPath(scene.truth(10), W, H, { reference: path.points })!;
    expect(other.points).toHaveLength(32);
  });
});

describe("tracking a moving object", () => {
  it("keeps the mask on the object over 60 frames (mean IoU >= 0.8) forward and backward", async () => {
    const anchorPath = await clickPath();
    const forward = await trackObjectMask({ segmenter, readFrame: async (f) => scene.frame(f), anchorFrame: 0, anchorPath, direction: "forward", endFrame: FRAMES - 1 });
    expect(forward).toHaveLength(FRAMES);
    const ious = forward.map((t) => maskIoU(rasterizePath(t.path, W, H), scene.truth(t.frame)));
    const mean = ious.reduce((a, b) => a + b, 0) / ious.length;
    console.log("forward mean IoU", mean.toFixed(3), "min", Math.min(...ious).toFixed(3), "lost", forward.filter((t) => t.lost).length);
    expect(mean).toBeGreaterThanOrEqual(0.8);
    expect(forward.every((t) => t.path.points.length === 32)).toBe(true);

    // Backward from the last frame: anchor there with the truth outline, track to frame 0.
    const last = maskToPath(scene.truth(FRAMES - 1), W, H)!;
    const backward = await trackObjectMask({ segmenter, readFrame: async (f) => scene.frame(f), anchorFrame: FRAMES - 1, anchorPath: last, direction: "backward", endFrame: 0 });
    expect(backward).toHaveLength(FRAMES);
    const biou = backward.map((t) => maskIoU(rasterizePath(t.path, W, H), scene.truth(t.frame)));
    const bmean = biou.reduce((a, b) => a + b, 0) / biou.length;
    console.log("backward mean IoU", bmean.toFixed(3), "min", Math.min(...biou).toFixed(3), biou.map((v, i) => `${i}:${v.toFixed(2)}`).filter((_, i) => biou[i] < 0.7).join(" "), backward.filter((t) => t.lost).map((t) => t.frame));
    expect(bmean).toBeGreaterThanOrEqual(0.8);
  }, 120_000);

  it("stops cleanly when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      trackObjectMask({ segmenter, readFrame: async (f) => scene.frame(f), anchorFrame: 0, anchorPath: await clickPath(), direction: "forward", endFrame: 5, signal: controller.signal }),
    ).rejects.toThrow(/cancel/i);
  });
});

describe("mask look: feather, expand, invert", () => {
  const disc = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) disc[y * W + x] = (x - 96) ** 2 + (y - 54) ** 2 <= 20 * 20 ? 1 : 0;
  const look = { feathering: 0, expansion: 0, inverted: false, opacity: 1 };

  it("expansion grows and shrinks the matte by whole pixels", () => {
    const base = maskArea(disc);
    expect(maskArea(growMask(disc, W, H, 4))).toBeGreaterThan(base * 1.3);
    expect(maskArea(growMask(disc, W, H, -4))).toBeLessThan(base * 0.75);
    const grown = applyMaskLook(disc, W, H, { ...look, expansion: 5 });
    expect(grown[54 * W + 96 + 24]).toBe(1);
    expect(grown[54 * W + 96 + 27]).toBe(0);
  });

  it("feathering softens the edge and keeps the core", () => {
    const soft = applyMaskLook(disc, W, H, { ...look, feathering: 8 });
    expect(soft[54 * W + 96]).toBeGreaterThan(0.99);
    const edge = soft[54 * W + 96 + 20];
    expect(edge).toBeGreaterThan(0.05);
    expect(edge).toBeLessThan(0.95);
    expect(soft[54 * W + 96 + 40]).toBeLessThan(0.01);
  });

  it("invert swaps inside and outside, opacity scales both", () => {
    const inv = applyMaskLook(disc, W, H, { ...look, inverted: true });
    expect(inv[54 * W + 96]).toBe(0);
    expect(inv[2 * W + 2]).toBe(1);
    const half = applyMaskLook(disc, W, H, { ...look, inverted: true, opacity: 0.5 });
    expect(half[2 * W + 2]).toBeCloseTo(0.5, 5);
  });
});

describe("keyframes after tracking", () => {
  const frames: ObjectTrackFrame[] = Array.from({ length: 10 }, (_, f) => ({
    frame: f,
    confidence: 1,
    lost: false,
    path: { closed: true, points: [{ x: 0.1 + f * 0.01, y: 0.1 }, { x: 0.3 + f * 0.01, y: 0.1 }, { x: 0.3 + f * 0.01, y: 0.4 }, { x: 0.1 + f * 0.01, y: 0.4 }] },
  }));
  const keys = trackedFramesToKeyframes(frames, { timeOf: (f) => f / 10, makeId: (() => { let i = 0; return () => `k${i++}`; })() });
  const mask = (): Mask => ({ id: "m", clipId: "c", type: "drawn", path: keys[0].path, feathering: 0, inverted: false, expansion: 0, opacity: 1, keyframes: keys });

  it("produces one sorted linear keyframe per tracked frame", () => {
    expect(keys).toHaveLength(10);
    expect(keys.map((k) => k.time)).toEqual([...keys.map((k) => k.time)].sort((a, b) => a - b));
    expect(maskPathAtTime(mask(), 0.25).points[0].x).toBeCloseTo(0.125, 6);
  });

  it("editing a vertex at a frame rewrites that keyframe only", () => {
    const edited = editMaskPathAtTime(mask(), 0.3, (p) => ({ ...p, points: p.points.map((pt, i) => (i === 0 ? { ...pt, x: 0.9 } : pt)) }), 0.01);
    expect(edited.keyframes).toHaveLength(10);
    expect(edited.keyframes.find((k) => Math.abs(k.time - 0.3) < 1e-9)!.path.points[0].x).toBe(0.9);
    expect(edited.keyframes.filter((k) => k.path.points[0].x === 0.9)).toHaveLength(1);
    // A time between keyframes adds one.
    const between = editMaskPathAtTime(mask(), 0.35, (p) => p, 0.01);
    expect(between.keyframes).toHaveLength(11);
  });

  it("re-tracking a range replaces only keyframes inside it", () => {
    const rerun = trackedFramesToKeyframes(frames.slice(4, 7).map((f) => ({ ...f, path: { ...f.path, points: f.path.points.map((p) => ({ ...p, y: p.y + 0.2 })) } })), { timeOf: (f) => f / 10, makeId: () => "new" });
    const merged = mergeTrackedKeyframes(keys, rerun);
    expect(merged).toHaveLength(10);
    expect(merged.filter((k) => k.id === "new")).toHaveLength(3);
    expect(merged[3].id).toBe("k3");
    expect(merged[7].id).toBe("k7");
  });
});

describe("effect masks", () => {
  it("split into masks that cut the clip and masks that only scope its effects", async () => {
    const { splitMasksByTarget } = await import("../mask-engine");
    const base = { id: "a", clipId: "c", type: "drawn" as const, path: { closed: true, points: [] }, feathering: 0, inverted: false, expansion: 0, opacity: 1, keyframes: [] };
    const masks: Mask[] = [base, { ...base, id: "b", appliesTo: "effects" }, { ...base, id: "c", appliesTo: "visibility" }];
    const { visibility, effects } = splitMasksByTarget(masks);
    expect(visibility.map((m) => m.id)).toEqual(["a", "c"]);
    expect(effects.map((m) => m.id)).toEqual(["b"]);
  });
});
