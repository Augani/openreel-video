import { describe, expect, it } from "vitest";
import {
  clipPolygon,
  crossZoomPlan,
  crossZoomState,
  cubeFaces,
  cubeSpinPlan,
  faceOrientation,
  flipFaces,
  flipOverPlan,
  pagePeelPlan,
  peelGeometry,
  projectFacePoint,
  rasterizePlan,
  solveFaceColumns,
  splitPlan,
  type DrawPlan,
} from "./transition-plans";

const W = 320;
const H = 180;
const A: [number, number, number] = [220, 40, 40];
const B: [number, number, number] = [40, 60, 220];
const PROGRESS = [0, 0.25, 0.5, 0.75, 1] as const;
const DIRECTIONS = ["left", "right", "up", "down"] as const;

const render = (plan: DrawPlan) => rasterizePlan(plan, W, H, { A, B });
const px = (data: Float64Array, x: number, y: number) => [0, 1, 2].map((c) => data[(y * W + x) * 3 + c]!);
const isColor = (data: Float64Array, x: number, y: number, color: readonly number[], tolerance = 1) =>
  px(data, x, y).every((v, c) => Math.abs(v - color[c]!) <= tolerance);
const isBlack = (data: Float64Array, x: number, y: number) => isColor(data, x, y, [0, 0, 0]);
const count = (data: Float64Array, color: readonly number[], tolerance = 1) => {
  let n = 0;
  for (let i = 0; i < W * H; i += 1) if ([0, 1, 2].every((c) => Math.abs(data[i * 3 + c]! - color[c]!) <= tolerance)) n += 1;
  return n;
};
const mirrorX = (data: Float64Array) => {
  const out = new Float64Array(data.length);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) for (let c = 0; c < 3; c += 1) out[(y * W + x) * 3 + c] = data[(y * W + (W - 1 - x)) * 3 + c]!;
  return out;
};
const mirrorY = (data: Float64Array) => {
  const out = new Float64Array(data.length);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) for (let c = 0; c < 3; c += 1) out[(y * W + x) * 3 + c] = data[((H - 1 - y) * W + x) * 3 + c]!;
  return out;
};
const meanDiff = (a: Float64Array, b: Float64Array) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / a.length;

const cubePlan = (direction: string, progress: number, extra: Record<string, unknown> = {}) =>
  cubeSpinPlan({ width: W, height: H, progress, direction, borderWidth: 0, borderColor: "#00c800", ...extra });
const flipPlan = (direction: string, progress: number, extra: Record<string, unknown> = {}) =>
  flipOverPlan({ width: W, height: H, progress, direction, borderWidth: 0, borderColor: "#00c800", ...extra });

describe("cube spin geometry", () => {
  it("shows exactly the outgoing frame at 0 and the incoming frame at 1, in every direction", () => {
    for (const direction of DIRECTIONS) {
      const first = render(cubePlan(direction, 0));
      const last = render(cubePlan(direction, 1));
      expect(count(first, A), direction).toBe(W * H);
      expect(count(last, B), direction).toBe(W * H);
    }
  });

  it("is a rotation in perspective: the faces meet along one edge and the near edge keeps the frame's height", () => {
    const { faces, focal } = cubeFaces(0.5, 1);
    const [front, side] = faces.map((f) => solveFaceColumns(f, focal, 1000)!);
    expect(front).not.toBeNull();
    expect(side).not.toBeNull();
    // They touch at the shared edge, whichever way the cube turned, and do not overlap.
    expect(front!.end).toBeCloseTo(side!.start, 2);
    expect(front!.scaleEnd).toBeCloseTo(1, 2);
    expect(side!.scaleStart).toBeCloseTo(1, 2);
    // The far ends are smaller, and nothing spills out of the frame.
    expect(front!.scaleStart).toBeLessThan(0.8);
    expect(side!.scaleEnd).toBeLessThan(0.8);
    // The far corners swing slightly past the frame edge (cropped by the frame), never far.
    expect(front!.start).toBeGreaterThan(-0.1);
    expect(side!.end).toBeLessThan(1.1);
  });

  it("converges to a vanishing point on the horizon: edge heights are linear in screen position and vanish at f * a1 / b1", () => {
    for (const progress of [0.3, 0.5, 0.7]) {
      for (const sign of [1, -1] as const) {
        const { faces, focal } = cubeFaces(progress, sign);
        for (const face of faces) {
          const samples = [0, 0.25, 0.5, 0.75, 1].map((u) => projectFacePoint(face, focal, u));
          // height(x) = alpha + beta * x exactly for a perspective projection of a line receding in depth.
          const beta = (samples[4]!.scale - samples[0]!.scale) / (samples[4]!.x - samples[0]!.x);
          for (const s of samples) expect(s.scale).toBeCloseTo(samples[0]!.scale + beta * (s.x - samples[0]!.x), 9);
          // The edges' height shrinks to zero at the vanishing point x = f * a1 / b1, on the horizon (the frame's centre line).
          const vanishingX = (focal * face.a1) / face.b1;
          expect(samples[0]!.scale + beta * (vanishingX - samples[0]!.x)).toBeCloseTo(0, 9);
          // Receding towards the vanishing point means getting smaller.
          expect(beta * (vanishingX - samples[0]!.x)).toBeLessThan(0);
        }
      }
    }
  });

  it("never inverts a face: visible faces face the camera, source columns advance in order, depths stay in front", () => {
    for (const sign of [1, -1] as const) {
      for (let k = 1; k < 100; k += 1) {
        const progress = k / 100;
        const { faces, focal } = cubeFaces(progress, sign);
        let shown = 0;
        let previousEnd = -Infinity;
        for (const face of faces) {
          // Depth never reaches the camera.
          for (const u of [0, 0.5, 1]) expect(face.b0 + face.b1 * u).toBeGreaterThan(1);
          const solved = solveFaceColumns(face, focal, 400);
          if (!solved) {
            // Only a face that turned away is culled.
            expect(faceOrientation(face)).toBeLessThanOrEqual(1e-9);
            continue;
          }
          shown += 1;
          expect(faceOrientation(face)).toBeGreaterThan(0);
          const ordered = [...solved.columns].sort((a, b) => a.index - b.index);
          for (let i = 0; i < ordered.length; i += 1) {
            const c = ordered[i]!;
            expect(c.to).toBeGreaterThan(c.from);
            expect(c.scale).toBeGreaterThan(0);
            if (i > 0) expect(c.from).toBeGreaterThanOrEqual(ordered[i - 1]!.from - 1e-9);
          }
        }
        expect(shown, `p=${progress} sign=${sign}`).toBeGreaterThanOrEqual(1);
        // The two faces do not overlap on screen.
        const solvedFaces = faces.map((f) => solveFaceColumns(f, focal, 400)).filter((s) => s !== null);
        const spans = solvedFaces.map((s) => [s!.start, s!.end]).sort((a, b) => a![0]! - b![0]!);
        for (const [start, end] of spans) {
          expect(start!).toBeGreaterThanOrEqual(previousEnd - 1e-6);
          previousEnd = end!;
        }
      }
    }
  });

  it("renders the outgoing frame on the side it turns towards and the incoming one entering from the other", () => {
    const expectations: Record<string, { a: [number, number]; b: [number, number] }> = {
      left: { a: [40, 90], b: [280, 90] },
      right: { a: [280, 90], b: [40, 90] },
      up: { a: [160, 30], b: [160, 150] },
      down: { a: [160, 150], b: [160, 30] },
    };
    for (const direction of DIRECTIONS) {
      const mid = render(cubePlan(direction, 0.5));
      const { a, b } = expectations[direction]!;
      expect(isColor(mid, a[0], a[1], A), `${direction} outgoing side`).toBe(true);
      expect(isColor(mid, b[0], b[1], B), `${direction} incoming side`).toBe(true);
      // The far corners fall outside the cube's silhouette.
      expect(isBlack(mid, 1, 1), `${direction} corner`).toBe(true);
    }
  });

  it("moves from outgoing to incoming over 0, 0.25, 0.5, 0.75, 1 without going back", () => {
    for (const direction of DIRECTIONS) {
      const shares = PROGRESS.map((p) => {
        const frame = render(cubePlan(direction, p));
        return { a: count(frame, A), b: count(frame, B) };
      });
      for (let i = 1; i < shares.length; i += 1) {
        expect(shares[i]!.b, `${direction} incoming grows`).toBeGreaterThanOrEqual(shares[i - 1]!.b);
        expect(shares[i]!.a, `${direction} outgoing shrinks`).toBeLessThanOrEqual(shares[i - 1]!.a);
      }
      expect(shares[1]!.a).toBeGreaterThan(shares[1]!.b);
      expect(shares[3]!.b).toBeGreaterThan(shares[3]!.a);
    }
  });

  it("the right and down turns are mirror images of the left and up turns", () => {
    for (const p of [0.25, 0.5, 0.75]) {
      expect(meanDiff(render(cubePlan("right", p)), mirrorX(render(cubePlan("left", p)))), `right p=${p}`).toBeLessThan(1.5);
      expect(meanDiff(render(cubePlan("down", p)), mirrorY(render(cubePlan("up", p)))), `down p=${p}`).toBeLessThan(1.5);
    }
  });

  it("outlines the faces with the border, and only while turning", () => {
    const green = [0, 200, 0];
    for (const direction of DIRECTIONS) {
      expect(count(render(cubePlan(direction, 0.5, { borderWidth: 6 })), green, 2), direction).toBeGreaterThan(100);
      expect(count(render(cubePlan(direction, 0, { borderWidth: 6 })), green, 2), `${direction} at 0`).toBe(0);
      expect(count(render(cubePlan(direction, 1, { borderWidth: 6 })), green, 2), `${direction} at 1`).toBe(0);
      expect(count(render(cubePlan(direction, 0.5)), green, 2), `${direction} without border`).toBe(0);
    }
  });
});

describe("flip over geometry", () => {
  it("shows the outgoing frame at 0 and the incoming frame at 1", () => {
    for (const direction of DIRECTIONS) {
      expect(count(render(flipPlan(direction, 0)), A)).toBe(W * H);
      expect(count(render(flipPlan(direction, 1)), B)).toBe(W * H);
    }
  });

  it("turns the card: outgoing on the front until it is edge-on, the incoming shot on the back, never mirrored", () => {
    for (const direction of DIRECTIONS) {
      const quarter = render(flipPlan(direction, 0.25));
      const threeQuarters = render(flipPlan(direction, 0.75));
      expect(isColor(quarter, 160, 90, A), `${direction} 0.25 centre`).toBe(true);
      expect(isColor(threeQuarters, 160, 90, B), `${direction} 0.75 centre`).toBe(true);
      expect(isBlack(quarter, 1, 1), `${direction} 0.25 corner`).toBe(true);
      expect(isBlack(threeQuarters, 1, 1), `${direction} 0.75 corner`).toBe(true);
      expect(count(quarter, B)).toBe(0);
      expect(count(threeQuarters, A)).toBe(0);
    }
  });

  it("is symmetric about the half way point: 0.25 and 0.75 cover the same area", () => {
    for (const direction of DIRECTIONS) {
      expect(Math.abs(count(render(flipPlan(direction, 0.25)), A) - count(render(flipPlan(direction, 0.75)), B)), direction).toBeLessThan(W * H * 0.01);
    }
  });

  it("is edge-on at the half way point, and the card narrows then widens", () => {
    for (const direction of DIRECTIONS) {
      const widths = [0.1, 0.25, 0.4, 0.6, 0.75, 0.9].map((p) => count(render(flipPlan(direction, p)), p < 0.5 ? A : B));
      expect(widths[0]!).toBeGreaterThan(widths[1]!);
      expect(widths[1]!).toBeGreaterThan(widths[2]!);
      expect(widths[3]!).toBeLessThan(widths[4]!);
      expect(widths[4]!).toBeLessThan(widths[5]!);
    }
  });

  it("never inverts: the front is seen from the front until the card is edge-on, the back (mirrored) after", () => {
    for (const sign of [1, -1] as const) {
      for (let k = 1; k < 100; k += 1) {
        if (k === 50) continue;
        const progress = k / 100;
        const { faces, focal } = flipFaces(progress, sign);
        const shown = faces.map((f) => solveFaceColumns(f, focal, 400)).filter((s) => s !== null);
        expect(shown, `p=${progress}`).toHaveLength(1);
        expect(shown[0]!.face.src).toBe(progress < 0.5 ? "A" : "B");
        const ordered = [...shown[0]!.columns].sort((a, b) => a.index - b.index);
        for (let i = 1; i < ordered.length; i += 1) {
          // The shot's columns advance with the screen on both sides of the card: the back reads unmirrored.
          expect(ordered[i]!.from - ordered[i - 1]!.from).toBeGreaterThanOrEqual(-1e-9);
        }
        for (const c of ordered) expect(c.scale).toBeGreaterThan(0);
        for (const face of faces) for (const u of [0, 1]) expect(face.b0 + face.b1 * u).toBeGreaterThan(1);
      }
    }
  });

  it("the right and down flips are mirror images of the left and up flips", () => {
    for (const p of [0.25, 0.75]) {
      expect(meanDiff(render(flipPlan("right", p)), mirrorX(render(flipPlan("left", p)))), `right ${p}`).toBeLessThan(1.5);
      expect(meanDiff(render(flipPlan("down", p)), mirrorY(render(flipPlan("up", p)))), `down ${p}`).toBeLessThan(1.5);
    }
  });

  it("outlines the card with the border while it turns", () => {
    expect(count(render(flipPlan("left", 0.25, { borderWidth: 6 })), [0, 200, 0], 2)).toBeGreaterThan(100);
    expect(count(render(flipPlan("left", 0, { borderWidth: 6 })), [0, 200, 0], 2)).toBe(0);
  });
});

describe("split", () => {
  const plan = (progress: number, extra: Record<string, unknown> = {}) =>
    splitPlan({ width: W, height: H, progress, orientation: "horizontal", reverse: false, borderWidth: 0, borderColor: "#00c800", ...extra });

  it("shows the outgoing frame at 0 and the incoming one at 1", () => {
    for (const orientation of ["horizontal", "vertical"]) for (const reverse of [false, true]) {
      expect(count(render(plan(0, { orientation, reverse })), A), `${orientation} ${reverse}`).toBe(W * H);
      expect(count(render(plan(1, { orientation, reverse })), B), `${orientation} ${reverse}`).toBe(W * H);
    }
  });

  it("slides the outgoing halves apart, opening the incoming shot from the centre line", () => {
    for (const p of PROGRESS) {
      const frame = render(plan(p));
      const openWidth = Math.round(p * W);
      expect(count(frame, B), `p=${p}`).toBe(openWidth * H);
      expect(count(frame, A), `p=${p}`).toBe((W - openWidth) * H);
      if (p > 0 && p < 1) {
        expect(isColor(frame, W / 2, 90, B)).toBe(true);
        expect(isColor(frame, 2, 90, A)).toBe(true);
        expect(isColor(frame, W - 3, 90, A)).toBe(true);
      }
    }
  });

  it("vertical orientation splits along a horizontal seam", () => {
    for (const p of [0.25, 0.5, 0.75]) {
      const frame = render(plan(p, { orientation: "vertical" }));
      expect(count(frame, B), `p=${p}`).toBe(Math.round(p * H) * W);
      expect(isColor(frame, 160, H / 2, B)).toBe(true);
      expect(isColor(frame, 160, 2, A)).toBe(true);
    }
  });

  it("reverse brings the incoming halves in from the sides over the outgoing shot", () => {
    for (const p of PROGRESS) {
      const frame = render(plan(p, { reverse: true }));
      expect(count(frame, B), `p=${p}`).toBe((W - Math.round((1 - p) * W)) * H);
    }
    const mid = render(plan(0.5, { reverse: true }));
    expect(isColor(mid, 2, 90, B)).toBe(true);
    expect(isColor(mid, W / 2, 90, A)).toBe(true);
  });

  it("draws the border on the inner edges of the moving halves", () => {
    const frame = render(plan(0.5, { borderWidth: 8 }));
    const green = [0, 200, 0];
    expect(count(frame, green)).toBe(16 * H);
    expect(isColor(frame, 160 - 80 - 4, 90, green)).toBe(true);
    expect(count(render(plan(0, { borderWidth: 8 })), green)).toBe(0);
    expect(count(render(plan(1, { borderWidth: 8 })), green)).toBe(0);
  });
});

describe("cross zoom", () => {
  const plan = (progress: number, extra: Record<string, unknown> = {}) =>
    crossZoomPlan({ width: W, height: H, progress, center: { x: 0.5, y: 0.5 }, intensity: 1, ...extra });

  it("is the outgoing frame at 0 and the incoming one at 1, a plain blend of both between", () => {
    expect(count(render(plan(0)), A)).toBe(W * H);
    expect(count(render(plan(1)), B)).toBe(W * H);
    expect(isColor(render(plan(0.25)), 160, 90, A, 1)).toBe(true);
    expect(isColor(render(plan(0.75)), 160, 90, B, 1)).toBe(true);
    const mid = px(render(plan(0.5)), 160, 90);
    for (let c = 0; c < 3; c += 1) expect(Math.abs(mid[c]! - (A[c]! + B[c]!) / 2)).toBeLessThan(3);
  });

  it("zooms the outgoing shot in and the incoming one settles from the same zoom: they match half way", () => {
    expect(crossZoomState(0, 1).zoomA).toBe(1);
    expect(crossZoomState(1, 1).zoomB).toBe(1);
    expect(crossZoomState(0.5, 1).zoomA).toBeCloseTo(crossZoomState(0.5, 1).zoomB, 9);
    let last = 1;
    for (let k = 1; k <= 20; k += 1) {
      const zoom = crossZoomState(k / 20, 1).zoomA;
      expect(zoom).toBeGreaterThanOrEqual(last);
      last = zoom;
    }
    let weight = 0;
    for (let k = 0; k <= 20; k += 1) {
      const next = crossZoomState(k / 20, 1).weightB;
      expect(next).toBeGreaterThanOrEqual(weight);
      weight = next;
    }
    expect(crossZoomState(0.5, 2).zoomA).toBeGreaterThan(crossZoomState(0.5, 1).zoomA);
    expect(crossZoomState(0, 1).blur).toBe(0);
    expect(crossZoomState(1, 1).blur).toBeCloseTo(0, 9);
  });

  it("averages its zoom samples evenly: every sample ends with the same weight", () => {
    const state = crossZoomState(0.5, 1);
    const layers = plan(0.5).filter((l) => l.kind === "rect");
    const weights = layers.map((l, i) => {
      let w = l.alpha ?? 1;
      for (let j = i + 1; j < layers.length; j += 1) w *= 1 - (layers[j]!.alpha ?? 1);
      return w;
    });
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    const outgoing = weights.slice(0, layers.length / 2);
    const incoming = weights.slice(layers.length / 2);
    for (const w of outgoing) expect(w).toBeCloseTo((1 - state.weightB) / outgoing.length, 9);
    for (const w of incoming) expect(w).toBeCloseTo(state.weightB / incoming.length, 9);
  });

  it("zooms about the chosen centre", () => {
    const layers = plan(0.3, { center: { x: 0.25, y: 0.75 } }).filter((l) => l.kind === "rect");
    for (const layer of layers) {
      if (layer.kind !== "rect") continue;
      const [dx, dy, dw, dh] = layer.d;
      // The fixed point of the scaling is the centre: it maps onto itself.
      expect(dx + (dw / W) * 0.25 * W).toBeCloseTo(0.25 * W, 6);
      expect(dy + (dh / H) * 0.75 * H).toBeCloseTo(0.75 * H, 6);
    }
  });
});

describe("page peel", () => {
  const plan = (progress: number, corner: string, shadow = 0) => pagePeelPlan({ width: W, height: H, progress, corner, shadow });
  const CORNERS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
  const cornerPoint: Record<string, [number, number]> = { topLeft: [1, 1], topRight: [W - 2, 1], bottomLeft: [1, H - 2], bottomRight: [W - 2, H - 2] };
  const oppositePoint: Record<string, [number, number]> = { topLeft: [W - 2, H - 2], topRight: [1, H - 2], bottomLeft: [W - 2, 1], bottomRight: [1, 1] };
  const area = (poly: readonly (readonly [number, number])[]) => Math.abs(poly.reduce((s, p, i) => s + (p[0] * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * p[1]), 0)) / 2;

  it("shows the outgoing page at 0 and the incoming shot at 1", () => {
    for (const corner of CORNERS) {
      expect(count(render(plan(0, corner)), A), corner).toBe(W * H);
      expect(count(render(plan(1, corner)), B), corner).toBe(W * H);
    }
  });

  it("peels from the chosen corner: that corner shows the incoming shot, the far one keeps the page", () => {
    for (const corner of CORNERS) {
      for (const p of [0.25, 0.5, 0.75]) {
        const frame = render(plan(p, corner));
        const [cx, cy] = cornerPoint[corner]!;
        expect(isColor(frame, cx, cy, B), `${corner} p=${p} corner`).toBe(true);
        if (p <= 0.5) {
          const [ox, oy] = oppositePoint[corner]!;
          const far = px(frame, ox, oy);
          // Untouched page, or (at the half way point) the tip of the flap.
          expect(far[0]! > far[2]!, `${corner} p=${p} far corner`).toBe(true);
        }
      }
    }
  });

  it("uncovers an area that grows with the peel and equals the peeled triangle while the flap stays on the page", () => {
    for (const corner of CORNERS) {
      let last = 0;
      for (const p of PROGRESS) {
        const frame = render(plan(p, corner));
        const bCount = count(frame, B);
        expect(bCount, `${corner} p=${p}`).toBeGreaterThanOrEqual(last);
        last = bCount;
        const g = peelGeometry(corner, p, W, H);
        const frameRect: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]];
        const along = g.corner[0] * g.d[0] + g.corner[1] * g.d[1] + g.fold;
        const peeled = clipPolygon(frameRect, -g.d[0], -g.d[1], -along);
        if (p > 0 && p < 1) expect(Math.abs(bCount - area(peeled)) / (W * H), `${corner} p=${p}`).toBeLessThan(0.01);
      }
    }
  });

  it("lifts the peeled part as a flap that lies on the page, inside the frame, tinted as the back of a sheet", () => {
    for (const corner of CORNERS) {
      const layers = plan(0.3, corner);
      const flap = layers.find((l) => l.kind === "poly" && l.matrix);
      expect(flap, corner).toBeDefined();
      if (flap?.kind !== "poly") continue;
      expect(flap.tint).toBeDefined();
      for (const [x, y] of flap.poly) {
        expect(x).toBeGreaterThanOrEqual(-1e-6);
        expect(x).toBeLessThanOrEqual(W + 1e-6);
        expect(y).toBeGreaterThanOrEqual(-1e-6);
        expect(y).toBeLessThanOrEqual(H + 1e-6);
      }
      const frame = render(layers);
      // Flap pixels are the page colour lightened by the tint.
      const tinted = [0, 1, 2].map((c) => A[c]! * 0.72 + 255 * 0.28);
      expect(count(frame, tinted, 1), corner).toBeGreaterThan(50);
    }
  });

  it("the four corners are mirror images of each other", () => {
    for (const p of [0.25, 0.5, 0.75]) {
      const br = render(plan(p, "bottomRight"));
      expect(meanDiff(render(plan(p, "bottomLeft")), mirrorX(br)), `bl ${p}`).toBeLessThan(1);
      expect(meanDiff(render(plan(p, "topRight")), mirrorY(br)), `tr ${p}`).toBeLessThan(1);
      expect(meanDiff(render(plan(p, "topLeft")), mirrorY(mirrorX(br))), `tl ${p}`).toBeLessThan(1);
    }
  });

  it("adds a shadow layer only when asked", () => {
    expect(plan(0.4, "bottomRight", 0.5).some((l) => l.kind === "gradient")).toBe(true);
    expect(plan(0.4, "bottomRight", 0).some((l) => l.kind === "gradient")).toBe(false);
  });
});
