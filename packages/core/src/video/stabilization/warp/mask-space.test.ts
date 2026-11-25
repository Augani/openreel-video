import { describe, expect, it } from "vitest";
import type { Mask } from "../../mask-engine";
import { warpPlanFor, type WarpClipLike } from "./apply";
import { framePlacement, isSourceSpaceMask, mapBezierPath, masksInStabilizedSpace, warpCompositionMap, warpFrameMap } from "./mask-space";
import { FRAME_STRIDE, WARP_ANALYSIS_VERSION, type WarpSettings } from "./types";

const W = 640;
const H = 360;

/** An analysis whose frame `i` moved by `deltas[i]` (dx, dy, rotation, logScale) from frame i-1. */
function clipOf(deltas: Array<[number, number, number, number]>, settings: Partial<WarpSettings>, id = "clip"): WarpClipLike {
  const motion: number[] = [];
  deltas.forEach((d, i) => {
    const row = new Array<number>(FRAME_STRIDE).fill(0);
    if (i > 0) [row[0], row[1], row[2], row[3]] = d;
    motion.push(...row);
  });
  return {
    id,
    stabilization: {
      enabled: true,
      warp: { result: "noMotion", framing: "stabilizeOnly", method: "positionScaleRotation", rollingShutter: "off", ...settings },
      warpAnalysis: { version: WARP_ANALYSIS_VERSION, fps: 30, startTime: 0, frameCount: deltas.length, width: W, height: H, motion, confidence: 1 },
    },
  };
}

const at = (frame: number) => frame / 30;
const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe("framePlacement", () => {
  it("is the identity for a frame that fills the canvas with no transform", () => {
    const map = framePlacement({ position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, fitMode: "contain" }, W, H, W, H)!;
    close(map.forward({ x: 0.3, y: 0.7 }), { x: 0.3, y: 0.7 });
    close(map.inverse({ x: 0.3, y: 0.7 }), { x: 0.3, y: 0.7 });
  });

  it("matches the compositor layout for position, scale and rotation, and inverts exactly", () => {
    const map = framePlacement({ position: { x: 64, y: -36 }, scale: { x: 0.5, y: 0.5 }, rotation: 90, anchor: { x: 0.5, y: 0.5 }, fitMode: "contain" }, W, H, W, H)!;
    // The frame centre lands on the canvas centre plus the position.
    close(map.forward({ x: 0.5, y: 0.5 }), { x: (W / 2 + 64) / W, y: (H / 2 - 36) / H });
    // The frame's right edge middle is 160 px (half of 640 * 0.5) from the centre, turned 90 degrees: straight down.
    close(map.forward({ x: 1, y: 0.5 }), { x: (W / 2 + 64) / W, y: (H / 2 - 36 + 160) / H });
    const p = { x: 0.21, y: 0.83 };
    close(map.inverse(map.forward(p)), p);
  });
});

describe("warp frame map", () => {
  it("is null without a finished analysis (identity: masks are untouched)", () => {
    expect(warpFrameMap({ id: "a" }, 0, W, H)).toBeNull();
    expect(warpFrameMap({ id: "a", stabilization: { enabled: false } }, 0, W, H)).toBeNull();
    const masks: Mask[] = [{ id: "m", clipId: "a", type: "drawn", path: { closed: true, points: [] }, feathering: 0, inverted: false, expansion: 0, opacity: 1, keyframes: [], space: "source" }];
    expect(masksInStabilizedSpace(masks, null, 0)).toBe(masks);
  });

  it("is exact for a pure translation", () => {
    // camera path 0, 10, 10: No Motion holds the middle (5), so frame 0 moves +5 px and frame 1 moves -5 px
    const clip = clipOf([[0, 0, 0, 0], [10, 4, 0, 0], [0, 0, 0, 0]], { method: "position" });
    const f0 = warpFrameMap(clip, at(0), W, H)!;
    close(f0.forward({ x: 0.25, y: 0.5 }), { x: 0.25 + 5 / W, y: 0.5 + 2 / H });
    close(f0.inverse({ x: 0.25 + 5 / W, y: 0.5 + 2 / H }), { x: 0.25, y: 0.5 });
    const f1 = warpFrameMap(clip, at(1), W, H)!;
    close(f1.forward({ x: 0.9, y: 0.1 }), { x: 0.9 - 5 / W, y: 0.1 - 2 / H });
  });

  it("is exact for a pure rotation about the frame centre", () => {
    const clip = clipOf([[0, 0, 0, 0], [0, 0, 0.2, 0], [0, 0, 0, 0]], {});
    const map = warpFrameMap(clip, at(0), W, H)!;
    // frame 0 is corrected by the half of the swing: +0.1 rad
    const angle = 0.1;
    const point = { x: 0.75, y: 0.5 };
    const dx = (point.x - 0.5) * W;
    const dy = (point.y - 0.5) * H;
    const expected = { x: (W / 2 + dx * Math.cos(angle) - dy * Math.sin(angle)) / W, y: (H / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)) / H };
    close(map.forward(point), expected);
    close(map.inverse(map.forward(point)), point);
    close(map.forward({ x: 0.5, y: 0.5 }), { x: 0.5, y: 0.5 });
  });

  it("is exact for a pure scale about the frame centre", () => {
    const clip = clipOf([[0, 0, 0, 0], [0, 0, 0, Math.log(1.2)], [0, 0, 0, 0]], {});
    const map = warpFrameMap(clip, at(0), W, H)!;
    // the correction at frame 0 is half of the log-scale swing
    const k = Math.exp(Math.log(1.2) / 2);
    close(map.forward({ x: 0.8, y: 0.25 }), { x: 0.5 + 0.3 * k, y: 0.5 - 0.25 * k });
  });

  it("includes the auto-scale zoom: the picture is magnified about the centre", () => {
    // camera path 0, 5, 10: frame 1 sits on the middle of the swing, so its only correction is the zoom
    const clip = clipOf([[0, 0, 0, 0], [5, 0, 0, 0], [5, 0, 0, 0]], { framing: "stabilizeCropAutoScale", result: "noMotion" });
    const zoom = warpPlanFor(clip)!.zoom;
    expect(zoom).toBeGreaterThan(1.01);
    const map = warpFrameMap(clip, at(1), W, H)!;
    close(map.forward({ x: 0.5, y: 0.5 }), { x: 0.5, y: 0.5 });
    close(map.forward({ x: 0.9, y: 0.2 }), { x: 0.5 + 0.4 * zoom, y: 0.5 - 0.3 * zoom });
    close(map.inverse({ x: 0.5 + 0.4 * zoom, y: 0.5 - 0.3 * zoom }), { x: 0.9, y: 0.2 });
  });

  it("is null for a time well outside the analysed footage (the frame is shown unmoved)", () => {
    const clip = clipOf([[0, 0, 0, 0], [10, 0, 0, 0]], {});
    expect(warpFrameMap(clip, 50, W, H)).toBeNull();
  });
});

describe("composition map and mask paths", () => {
  const clip = clipOf([[0, 0, 0, 0], [10, 6, 0, 0], [0, 0, 0, 0]], { method: "position" });
  const place = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, fitMode: "contain" as const };

  it("is the warp itself when the clip fills the canvas", () => {
    const map = warpCompositionMap(clip, at(0), W, H, framePlacement(place, W, H, W, H))!;
    close(map.forward({ x: 0.4, y: 0.4 }), { x: 0.4 + 5 / W, y: 0.4 + 3 / H });
  });

  it("is conjugated by the clip transform when the clip is scaled and moved", () => {
    const transform = { ...place, position: { x: 100, y: 20 }, scale: { x: 0.5, y: 0.5 } };
    const placement = framePlacement(transform, W, H, W, H)!;
    const map = warpCompositionMap(clip, at(0), W, H, placement)!;
    // a shift of 5 source pixels is 2.5 canvas pixels at half scale
    const here = placement.forward({ x: 0.5, y: 0.5 });
    const moved = map.forward(here);
    expect(moved.x - here.x).toBeCloseTo(2.5 / W, 6);
    expect(moved.y - here.y).toBeCloseTo(1.5 / H, 6);
    close(map.inverse(moved), here);
  });

  it("moves only source-space masks, sampling the keyframes at the render time first", () => {
    const placement = framePlacement(place, W, H, W, H);
    const map = warpCompositionMap(clip, at(0), W, H, placement)!;
    const square = (x: number) => ({ closed: true, points: [{ x, y: 0.4 }, { x: x + 0.1, y: 0.4 }, { x: x + 0.1, y: 0.5, handleOut: { x: x + 0.12, y: 0.52 } }] });
    const tracked: Mask = { id: "tracked", clipId: "clip", type: "drawn", path: square(0.1), feathering: 0, inverted: false, expansion: 0, opacity: 1, space: "source", keyframes: [{ id: "k0", time: 0, path: square(0.1), easing: "linear" }, { id: "k1", time: 1, path: square(0.5), easing: "linear" }] };
    const drawn: Mask = { ...tracked, id: "drawn", space: undefined };
    expect(isSourceSpaceMask(tracked)).toBe(true);
    const [a, b] = masksInStabilizedSpace([tracked, drawn], map, 0.5);
    expect(b).toBe(drawn);
    expect(a.keyframes).toEqual([]);
    // halfway between the keyframes the outline starts at x = 0.3, then the warp's +5 px, +3 px shift
    expect(a.path.points[0].x).toBeCloseTo(0.3 + 5 / W, 6);
    expect(a.path.points[0].y).toBeCloseTo(0.4 + 3 / H, 6);
    expect(a.path.points[2].handleOut!.x).toBeCloseTo(0.42 + 5 / W, 6);
  });

  it("maps a path and its handles with one function", () => {
    const mapped = mapBezierPath({ closed: false, points: [{ x: 1, y: 2, handleIn: { x: 3, y: 4 } }] }, (p) => ({ x: p.x * 2, y: p.y + 1 }));
    expect(mapped).toEqual({ closed: false, points: [{ x: 2, y: 3, handleIn: { x: 6, y: 5 } }] });
  });
});
