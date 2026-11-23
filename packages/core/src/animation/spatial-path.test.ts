import { describe, expect, it } from "vitest";
import type { Keyframe } from "../types/timeline";
import { AnimationEngine } from "../video/animation-engine";
import { keyframeEngine } from "../video/keyframe-engine";
import { evaluateKeyframesAt } from "./evaluate-keyframes";
import {
  applySpatialInterpolation,
  arcLengthTable,
  autoSpatialTangents,
  bezierArcLength,
  bezierPoint,
  pairPositionKeys,
  pointAtArcFraction,
  resolveSpatialVertices,
  samplePositionPath,
  sampleSpatialRoute,
  setSpatialHandle,
  type BezierSegment2D,
} from "./spatial-path";

const key = (id: string, property: string, time: number, value: number, extra: Partial<Keyframe> = {}): Keyframe =>
  ({ id, property, time, value, easing: "linear", ...extra });
const path = (pts: [number, number][], times = pts.map((_, i) => i)): Keyframe[] =>
  pts.flatMap(([x, y], i) => [key(`x${i}`, "position.x", times[i], x), key(`y${i}`, "position.y", times[i], y)]);
const ease = (t: number, k: Keyframe) => keyframeEngine.easeSegment(t, k);
const byId = (keys: Keyframe[], id: string) => keys.find((k) => k.id === id)!;

/** Independent reference: composite Simpson over |B'(u)|. */
function referenceLength(seg: BezierSegment2D, n = 4000): number {
  const speed = (u: number) => {
    const v = 1 - u;
    const dx = 3 * v * v * (seg.c1.x - seg.p0.x) + 6 * v * u * (seg.c2.x - seg.c1.x) + 3 * u * u * (seg.p3.x - seg.c2.x);
    const dy = 3 * v * v * (seg.c1.y - seg.p0.y) + 6 * v * u * (seg.c2.y - seg.c1.y) + 3 * u * u * (seg.p3.y - seg.c2.y);
    return Math.hypot(dx, dy);
  };
  let sum = speed(0) + speed(1);
  for (let i = 1; i < n; i++) sum += speed(i / n) * (i % 2 ? 4 : 2);
  return (sum * (1 / n)) / 3;
}

describe("spatial path arc length", () => {
  it("a straight segment's length is the chord", () => {
    const seg = { p0: { x: 0, y: 0 }, c1: { x: 100 / 3, y: 0 }, c2: { x: 200 / 3, y: 0 }, p3: { x: 100, y: 0 } };
    expect(bezierArcLength(seg)).toBeCloseTo(100, 9);
  });
  it("a quarter circle (kappa = 0.5522847498) has length pi*r/2", () => {
    const r = 200, k = 0.5522847498 * r;
    const seg = { p0: { x: r, y: 0 }, c1: { x: r, y: k }, c2: { x: k, y: r }, p3: { x: 0, y: r } };
    expect(bezierArcLength(seg) / ((Math.PI * r) / 2)).toBeCloseTo(1, 3);
    expect(Math.abs(bezierArcLength(seg) - referenceLength(seg))).toBeLessThan(0.02);
  });
  it("matches an independent Simpson integration on an asymmetric S curve", () => {
    const seg = { p0: { x: 0, y: 0 }, c1: { x: 300, y: -120 }, c2: { x: -80, y: 400 }, p3: { x: 220, y: 260 } };
    expect(bezierArcLength(seg) / referenceLength(seg)).toBeCloseTo(1, 3);
  });
  it("equal arc fractions are equal distances along the curve", () => {
    const seg = { p0: { x: 0, y: 0 }, c1: { x: 300, y: 0 }, c2: { x: 300, y: 300 }, p3: { x: 0, y: 300 } };
    const total = referenceLength(seg);
    for (const f of [0.1, 0.25, 0.5, 0.9]) {
      const point = pointAtArcFraction(seg, f);
      // Distance along the curve from the start to `point`, found by walking the table.
      const table = arcLengthTable(seg, 4096);
      let nearest = 0, best = Infinity;
      for (let i = 0; i < table.length; i++) {
        const q = bezierPoint(seg, i / (table.length - 1));
        const d = Math.hypot(q.x - point.x, q.y - point.y);
        if (d < best) { best = d; nearest = table[i]; }
      }
      expect(nearest / total).toBeCloseTo(f, 3);
    }
  });
  it("fractions outside 0..1 continue along the end tangent", () => {
    const seg = { p0: { x: 0, y: 0 }, c1: { x: 50, y: 0 }, c2: { x: 100, y: 50 }, p3: { x: 100, y: 100 } };
    const total = bezierArcLength(seg);
    const past = pointAtArcFraction(seg, 1.1);
    expect(past.x).toBeCloseTo(100, 6);
    expect(past.y).toBeCloseTo(100 + 0.1 * total, 6);
    expect(pointAtArcFraction(seg, -0.1).x).toBeLessThan(0);
  });
});

describe("auto spatial tangents", () => {
  it("run along the neighbour chord, a third of each leg long, flat at the ends", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 300, y: 100 }];
    const mid = autoSpatialTangents(pts, 1);
    const chord = { x: 300, y: 100 };
    const chordLen = Math.hypot(chord.x, chord.y);
    expect(mid.out.x / mid.out.y).toBeCloseTo(chord.x / chord.y, 9);
    expect(Math.hypot(mid.out.x, mid.out.y)).toBeCloseTo(200 / 3, 9);
    expect(Math.hypot(mid.in.x, mid.in.y)).toBeCloseTo(Math.hypot(100, 100) / 3, 9);
    expect(mid.in.x * mid.out.x + mid.in.y * mid.out.y).toBeLessThan(0); // opposite directions
    expect(chordLen).toBeGreaterThan(0);
    expect(autoSpatialTangents(pts, 0)).toEqual({ in: { x: 0, y: 0 }, out: { x: 0, y: 0 } });
    expect(autoSpatialTangents(pts, 2).out).toEqual({ x: 0, y: 0 });
  });
});

describe("samplePositionPath", () => {
  it("stays null (independent axes, legacy behaviour) for Linear and for unpaired keys", () => {
    expect(samplePositionPath(path([[0, 0], [100, 50], [200, 0]]), 0.5, ease)).toBeNull();
    const unpaired = [...path([[0, 0], [100, 50]]).map((k) => (k.id === "x1" ? { ...k, spatialMode: "auto-bezier" as const } : k)), key("extra", "position.x", 1.5, 3)];
    expect(samplePositionPath(unpaired, 0.5, ease)).toBeNull();
    expect(pairPositionKeys(unpaired)).toBeNull();
  });

  it("hits the keys exactly and holds outside the range", () => {
    const keys = applySpatialInterpolation(path([[0, 0], [100, 80], [200, 0]]), ["x1"], "auto-bezier");
    expect(samplePositionPath(keys, 0, ease)).toEqual({ x: 0, y: 0 });
    expect(samplePositionPath(keys, 1, ease)).toEqual({ x: 100, y: 80 });
    expect(samplePositionPath(keys, 2, ease)).toEqual({ x: 200, y: 0 });
    expect(samplePositionPath(keys, 9, ease)).toEqual({ x: 200, y: 0 });
  });

  it("follows the analytic Bezier at constant speed when the temporal curve is linear", () => {
    // Symmetric arch with explicit handles; linear temporal => position at arc fraction == t.
    let keys = path([[0, 0], [300, 0]]);
    keys = applySpatialInterpolation(keys, ["x0", "x1"], "bezier");
    keys = setSpatialHandle(keys, "x0", "out", { x: 0, y: 200 });
    keys = setSpatialHandle(keys, "x1", "in", { x: 0, y: 200 });
    const seg = { p0: { x: 0, y: 0 }, c1: { x: 0, y: 200 }, c2: { x: 300, y: 200 }, p3: { x: 300, y: 0 } };
    const total = referenceLength(seg);
    const mid = samplePositionPath(keys, 0.5, ease)!;
    expect(mid.x).toBeCloseTo(150, 2); // symmetry
    // Walking the reference curve: the point at t=0.25 is a quarter of the length from the start.
    const quarter = samplePositionPath(keys, 0.25, ease)!;
    let acc = 0, prev = seg.p0, found = { x: 0, y: 0 };
    for (let i = 1; i <= 20000; i++) {
      const q = bezierPoint(seg, i / 20000);
      acc += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
      if (acc >= total * 0.25) { found = q; break; }
    }
    expect(quarter.x).toBeCloseTo(found.x, 1);
    expect(quarter.y).toBeCloseTo(found.y, 1);
  });

  it("uses the temporal curve of the x key for timing (hold stays on the start)", () => {
    let keys = applySpatialInterpolation(path([[0, 0], [100, 100], [200, 0]]), ["x1"], "auto-bezier");
    keys = keys.map((k) => (k.id === "x0" ? { ...k, easing: "hold" as const } : k));
    expect(samplePositionPath(keys, 0.9, ease)).toEqual({ x: 0, y: 0 });
  });

  it("Linear spatial with identical temporal easing equals independent per-axis evaluation", () => {
    const keys = path([[0, 0], [100, 40], [220, -30]]).map((k) => ({ ...k, easing: "ease-in-out" as const }));
    const asPath = applySpatialInterpolation(keys, ["x0", "x1", "x2"], "linear");
    const mid = applySpatialInterpolation(keys, ["x1"], "bezier").map((k) => ({ ...k, spatialIn: { x: 0, y: 0 }, spatialOut: { x: 0, y: 0 } }));
    for (const t of [0, 0.3, 0.77, 1, 1.4, 2]) {
      const independent = evaluateKeyframesAt(asPath, t);
      const zero = evaluateKeyframesAt(mid.map((k) => (k.id === "x1" ? { ...k, spatialMode: "bezier" as const } : k)), t);
      expect(zero.get("position.x")).toBeCloseTo(independent.get("position.x")!, 9);
      expect(zero.get("position.y")).toBeCloseTo(independent.get("position.y")!, 9);
    }
  });

  it("evaluates identically through KeyframeEngine, AnimationEngine and evaluateKeyframesAt", () => {
    const keys = applySpatialInterpolation(path([[0, 0], [160, 90], [300, -40], [420, 60]]), ["x0", "x1", "x2", "x3"], "auto-bezier")
      .map((k) => (k.property === "position.x" && k.id === "x1" ? { ...k, easing: "ease-in" as const } : k));
    const anim = new AnimationEngine();
    for (let i = 0; i <= 60; i++) {
      const t = (3 * i) / 60;
      const a = samplePositionPath(keys, t, ease)!;
      const b = samplePositionPath(keys, t, (u, k) => anim.applyKeyframeEasing(u, k))!;
      const c = evaluateKeyframesAt(keys, t);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
      expect(c.get("position.x")).toBe(a.x);
      expect(c.get("position.y")).toBe(a.y);
    }
  });
});

describe("spatial edits", () => {
  it("auto-bezier stores nothing and linear removes the fields", () => {
    const auto = applySpatialInterpolation(path([[0, 0], [100, 100], [200, 0]]), ["y1"], "auto-bezier");
    expect(byId(auto, "x1").spatialMode).toBe("auto-bezier");
    expect(byId(auto, "x1").spatialOut).toBeUndefined();
    expect(byId(auto, "y1").spatialMode).toBeUndefined(); // the path lives on the x key
    const back = applySpatialInterpolation(auto, ["x1"], "linear");
    expect(byId(back, "x1").spatialMode).toBeUndefined();
  });

  it("dragging a handle on an Auto key converts it to Continuous with collinear handles", () => {
    const auto = applySpatialInterpolation(path([[0, 0], [100, 100], [200, 0]]), ["x1"], "auto-bezier");
    const dragged = setSpatialHandle(auto, "x1", "out", { x: 40, y: 80 });
    const k = byId(dragged, "x1");
    expect(k.spatialMode).toBe("continuous-bezier");
    expect(k.spatialOut).toEqual({ x: 40, y: 80 });
    const o = k.spatialOut!, i = k.spatialIn!;
    expect(o.x * i.y - o.y * i.x).toBeCloseTo(0, 9); // collinear
    expect(o.x * i.x + o.y * i.y).toBeLessThan(0); // pointing away from each other
  });

  it("Continuous keeps the other handle's length; Bezier breaks the link", () => {
    const cont = applySpatialInterpolation(path([[0, 0], [100, 100], [200, 0]]), ["x1"], "continuous-bezier");
    const inLen = Math.hypot(byId(cont, "x1").spatialIn!.x, byId(cont, "x1").spatialIn!.y);
    const moved = setSpatialHandle(cont, "x1", "out", { x: 0, y: 60 });
    expect(Math.hypot(byId(moved, "x1").spatialIn!.x, byId(moved, "x1").spatialIn!.y)).toBeCloseTo(inLen, 9);
    expect(byId(moved, "x1").spatialIn!.x).toBeCloseTo(0, 9);
    const bez = applySpatialInterpolation(path([[0, 0], [100, 100], [200, 0]]), ["x1"], "bezier");
    const broke = setSpatialHandle(bez, "x1", "out", { x: 10, y: 50 });
    expect(byId(broke, "x1").spatialMode).toBe("bezier");
    expect(byId(broke, "x1").spatialIn).toEqual(byId(bez, "x1").spatialIn);
  });

  it("a freshly Bezier key still draws a straight route until a handle is moved", () => {
    const bez = applySpatialInterpolation(path([[0, 0], [100, 100]]), ["x0", "x1"], "bezier");
    const mid = samplePositionPath(bez, 0.5, ease)!;
    expect(mid.x).toBeCloseTo(50, 6);
    expect(mid.y).toBeCloseTo(50, 6);
  });

  it("resolveSpatialVertices and sampleSpatialRoute expose the drawn route", () => {
    const keys = applySpatialInterpolation(path([[0, 0], [100, 100], [200, 0]]), ["x1"], "auto-bezier");
    const v = resolveSpatialVertices(keys)!;
    expect(v).toHaveLength(3);
    expect(v[1].tangentOut.x).toBeGreaterThan(0);
    const route = sampleSpatialRoute(keys, 10);
    expect(route).toHaveLength(21);
    expect(route[0]).toEqual({ x: 0, y: 0 });
    expect(route[10].x).toBeCloseTo(100, 9);
  });
});

describe("persistence", () => {
  it("spatial fields and temporal tags survive a JSON round trip and project load unchanged", async () => {
    const { normalizeProjectStoredFields } = await import("../storage/project-serializer");
    const keys = setSpatialHandle(applySpatialInterpolation(path([[0, 0], [100, 100], [200, 0]]), ["x0", "x1", "x2"], "auto-bezier"), "x1", "out", { x: 30, y: 60 });
    const project = { timeline: { tracks: [{ id: "t", clips: [{ id: "c", effects: [], keyframes: keys }] }] } };
    const loaded = normalizeProjectStoredFields(JSON.parse(JSON.stringify(project)));
    const back = (loaded as unknown as typeof project).timeline.tracks[0].clips[0].keyframes;
    expect(back).toEqual(keys);
    for (const t of [0.2, 0.9, 1.4]) {
      expect(samplePositionPath(back, t, ease)).toEqual(samplePositionPath(keys, t, ease));
    }
  });
});
