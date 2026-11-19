import { describe, expect, it } from "vitest";
import type { Keyframe } from "../types/timeline";
import { AnimationEngine } from "../video/animation-engine";
import { evaluateKeyframesAt } from "./evaluate-keyframes";
import { effectiveBezierHandles, solveBezierEase } from "./keyframe-bezier";
import { applyKeyframeInterpolation, keyframeSideTypes, refreshSmoothKeyframes, refreshSmoothKeyframesAfterEdit, segmentTangents } from "./keyframe-interpolation";

const kf = (id: string, time: number, value: number, easing: Keyframe["easing"] = "linear"): Keyframe => ({ id, time, property: "opacity", value, easing });
const three = () => [kf("a", 0, 0), kf("b", 1, 1), kf("c", 2, 0.5)];
const byId = (keys: Keyframe[], id: string) => keys.find(k => k.id === id)!;

describe("applyKeyframeInterpolation", () => {
  it("hold clears the segment's handles and both owners' tags; linear resets only the chosen key's handles", () => {
    const start = three().map(k => ({ ...k, easing: "bezier" as const, bezierHandles: { in: { x: 0.2, y: 0.9 }, out: { x: 0.8, y: 0.1 } }, interpolationIn: "auto-bezier" as const, interpolationOut: "auto-bezier" as const }));
    const hold = applyKeyframeInterpolation(start, ["a"], "hold");
    expect(byId(hold, "a")).toMatchObject({ easing: "hold" });
    expect(byId(hold, "a").bezierHandles).toBeUndefined();
    expect(byId(hold, "a").interpolationOut).toBeUndefined();
    expect(byId(hold, "b").interpolationIn).toBeUndefined();
    expect(byId(hold, "b").interpolationOut).toBe("auto-bezier");
    const lin = applyKeyframeInterpolation(start, ["b"], "linear");
    // b's outgoing handle is linear, but the far end (c's incoming) is not b's to change.
    expect(byId(lin, "b").bezierHandles!.in).toEqual({ x: 1 / 3, y: 1 / 3 });
    expect(byId(lin, "a").bezierHandles!.out.y).toBeCloseTo(2 / 3, 9);
    expect(byId(lin, "b").interpolationIn).toBeUndefined();
    expect(byId(lin, "b").interpolationOut).toBeUndefined();
    expect(byId(lin, "c").interpolationIn).toBe("auto-bezier");
    // Linear on both ends of a segment collapses to plain linear easing.
    const both = applyKeyframeInterpolation(start, ["b", "c"], "linear");
    expect(byId(both, "b").easing).toBe("linear");
    expect(byId(both, "b").bezierHandles).toBeUndefined();
  });

  it("in and out types are independent per key", () => {
    const out = applyKeyframeInterpolation(three(), ["b"], "auto-bezier", "out");
    expect(byId(out, "b").interpolationOut).toBe("auto-bezier");
    expect(byId(out, "b").interpolationIn).toBeUndefined();
    const inOnly = applyKeyframeInterpolation(out, ["b"], "linear", "in");
    expect(keyframeSideTypes(byId(inOnly, "a"), byId(inOnly, "b"))).toMatchObject({ out: "auto-bezier" });
    const mixed = applyKeyframeInterpolation(three(), ["b"], "ease-in");
    expect(keyframeSideTypes(byId(mixed, "a"), byId(mixed, "b"))).toEqual({ in: "bezier", out: "linear" });
    const held = applyKeyframeInterpolation(three(), ["b"], "hold");
    expect(keyframeSideTypes(byId(held, "a"), byId(held, "b"))).toEqual({ in: "linear", out: "hold" });
    expect(keyframeSideTypes(byId(held, "b"), byId(held, "c"), false)).toEqual({ in: "hold", out: undefined });
  });

  it("an Auto side never overwrites a hand-tuned handle at the other end of a shared segment", () => {
    // a->b is hand-tuned (plain Bezier keys); b is Auto on its OUT side only.
    const tuned = three().map(k => (k.id === "a" ? { ...k, easing: "bezier" as const, bezierHandles: { in: { x: 0.3, y: 0.2 }, out: { x: 0.7, y: 0.65 } } } : k));
    const out = applyKeyframeInterpolation(tuned, ["b"], "auto-bezier", "out");
    expect(byId(out, "a").bezierHandles).toEqual(byId(tuned, "a").bezierHandles);
    // Even a full-both Auto on b only rewrites b's own incoming handle (P2 of a->b), leaving a's outgoing P1.
    const both = applyKeyframeInterpolation(tuned, ["b"], "auto-bezier");
    expect(byId(both, "a").bezierHandles!.in).toEqual({ x: 0.3, y: 0.2 });
  });

  it("bezier freezes the current shape into editable handles without changing the curve", () => {
    const out = applyKeyframeInterpolation(three(), ["a"], "bezier");
    expect(byId(out, "a").easing).toBe("bezier");
    const h = byId(out, "a").bezierHandles!;
    expect(solveBezierEase(0.37, h.in.x, h.in.y, h.out.x, h.out.y)).toBeCloseTo(0.37, 6);
  });

  it("auto bezier: smooth tangent equal on both sides, flat at ends and at extrema", () => {
    const out = applyKeyframeInterpolation([kf("a", 0, 0), kf("b", 1, 1), kf("c", 2, 3), kf("d", 3, 2)], ["b"], "auto-bezier");
    const ks = out.filter(k => k.property === "opacity").sort((x, y) => x.time - y.time);
    const a = ks[0] as Keyframe & { value: number }, b = ks[1] as Keyframe & { value: number }, c = ks[2] as Keyframe & { value: number };
    const tin = segmentTangents(a, b, effectiveBezierHandles(a)!).in;
    const tout = segmentTangents(b, c, effectiveBezierHandles(b)!).out;
    expect(tin).toBeCloseTo(1.5, 6);
    expect(tout).toBeCloseTo(1.5, 6);
    expect(byId(out, "b")).toMatchObject({ interpolationIn: "auto-bezier", interpolationOut: "auto-bezier" });
    // end key auto => flat
    const ends = applyKeyframeInterpolation(three(), ["a"], "auto-bezier");
    expect(effectiveBezierHandles(byId(ends, "a"))!.in.y).toBeCloseTo(0, 9);
    // extremum: b is a peak in three() => flat both sides
    const peak = applyKeyframeInterpolation(three(), ["b"], "auto-bezier");
    expect(effectiveBezierHandles(byId(peak, "b"))!.in.y).toBeCloseTo(0, 9);
    expect(effectiveBezierHandles(byId(peak, "a"))!.out.y).toBeCloseTo(1, 9);
  });

  it("auto bezier re-derives when a neighbour moves", () => {
    const tagged = applyKeyframeInterpolation([kf("a", 0, 0), kf("b", 1, 1), kf("c", 2, 3)], ["b"], "auto-bezier");
    const moved = tagged.map(k => (k.id === "c" ? { ...k, value: 5 } : k));
    const refreshed = refreshSmoothKeyframes(moved, new Set(["c"]));
    const b = byId(refreshed, "b") as Keyframe & { value: number };
    const c = byId(refreshed, "c") as Keyframe & { value: number };
    expect(segmentTangents(b, c, effectiveBezierHandles(b)!).out).toBeCloseTo(2.5, 6);
  });

  it("continuous bezier mirrors the edited side's tangent onto the other", () => {
    const start = applyKeyframeInterpolation([kf("a", 0, 0), kf("b", 1, 1), kf("c", 2, 3)], ["b"], "continuous-bezier");
    const edited = start.map(k => (k.id === "b" ? { ...k, easing: "bezier" as const, bezierHandles: { in: { x: 1 / 3, y: 0.9 }, out: { x: 2 / 3, y: 0.4 } } } : k));
    const out = refreshSmoothKeyframes(edited, new Set(["b:out"]));
    const a = byId(out, "a") as Keyframe & { value: number }, b = byId(out, "b") as Keyframe & { value: number }, c = byId(out, "c") as Keyframe & { value: number };
    const tout = segmentTangents(b, c, effectiveBezierHandles(b)!).out;
    expect(tout).toBeCloseTo(0.9 * 2 * 3, 6);
    expect(segmentTangents(a, b, effectiveBezierHandles(a)!).in).toBeCloseTo(tout, 6);
  });

  it("ease in / ease out flatten the correct side only", () => {
    const eo = applyKeyframeInterpolation(three(), ["a"], "ease-out");
    expect(effectiveBezierHandles(byId(eo, "a"))!.in).toEqual({ x: 1 / 3, y: 0 });
    expect(effectiveBezierHandles(byId(eo, "a"))!.out).toEqual({ x: 2 / 3, y: 2 / 3 });
    const ei = applyKeyframeInterpolation(three(), ["b"], "ease-in");
    expect(effectiveBezierHandles(byId(ei, "a"))!.out.x).toBeCloseTo(2 / 3, 9);
    expect(effectiveBezierHandles(byId(ei, "a"))!.out.y).toBe(1);
    expect(effectiveBezierHandles(byId(ei, "a"))!.in).toEqual({ x: 1 / 3, y: 1 / 3 });
    expect(byId(ei, "b").easing).toBe("linear");
  });

  it("multi-select applies to every selected key across properties and is deterministic", () => {
    const keys = [...three(), { ...kf("r1", 0, 0), property: "rotation" }, { ...kf("r2", 1, 90), property: "rotation" }];
    const a = applyKeyframeInterpolation(keys, ["a", "r1"], "ease-out");
    expect(byId(a, "r1").easing).toBe("bezier");
    expect(byId(a, "a").easing).toBe("bezier");
    expect(applyKeyframeInterpolation(keys, ["a", "r1"], "ease-out")).toEqual(a);
  });

  it("preview, export and graph evaluate the baked curve identically", () => {
    const keys = applyKeyframeInterpolation([kf("a", 0, 0), kf("b", 1, 1), kf("c", 2, 3)], ["b"], "auto-bezier");
    const engine = new AnimationEngine();
    for (const t of [0.1, 0.5, 0.9, 1.3, 1.8]) {
      const viaEval = evaluateKeyframesAt(keys, t).get("opacity")!;
      const sorted = [...keys].sort((x, y) => x.time - y.time);
      const i = t < 1 ? 0 : 1;
      const p = (t - sorted[i].time) / (sorted[i + 1].time - sorted[i].time);
      const e = engine.applyKeyframeEasing(p, sorted[i]);
      const expected = (sorted[i].value as number) + ((sorted[i + 1].value as number) - (sorted[i].value as number)) * e;
      expect(viaEval).toBeCloseTo(expected, 6);
    }
  });

  it("legacy keyframes without interpolation are untouched by refresh", () => {
    const legacy = [kf("a", 0, 0, "ease-in"), kf("b", 1, 1, "bezier")];
    expect(refreshSmoothKeyframes(legacy)).toEqual(legacy);
  });
});

describe("user edits on smooth keys", () => {
  const edit = (prior: Keyframe[], id: string, updates: Partial<Keyframe>) =>
    refreshSmoothKeyframesAfterEdit(prior, prior.map(k => {
      if (k.id !== id) return k;
      const next = { ...k, ...updates } as Record<string, unknown>;
      for (const [f, v] of Object.entries(updates)) if (v === undefined) delete next[f];
      return next as unknown as Keyframe;
    }));

  it("dragging one handle of an auto side keeps it and converts only that side to plain Bezier", () => {
    const auto = applyKeyframeInterpolation(three(), ["a", "b", "c"], "auto-bezier");
    const base = byId(auto, "b").bezierHandles!;
    const handles = { in: { x: 0.5, y: 0.1 }, out: base.out };
    const out = edit(auto, "b", { easing: "bezier", bezierHandles: handles });
    expect(byId(out, "b").bezierHandles).toEqual(handles);
    expect(byId(out, "b").interpolationOut).toBeUndefined();
    expect(byId(out, "b").interpolationIn).toBe("auto-bezier");
    expect(byId(out, "c").interpolationIn).toBe("auto-bezier");
  });

  it("dragging the entering handle clears the far key's incoming tag", () => {
    const auto = applyKeyframeInterpolation(three(), ["a", "b", "c"], "auto-bezier");
    const handles = { in: byId(auto, "a").bezierHandles!.in, out: { x: 0.9, y: 0.7 } };
    const out = edit(auto, "a", { easing: "bezier", bezierHandles: handles });
    expect(byId(out, "a").bezierHandles).toEqual(handles);
    expect(byId(out, "b").interpolationIn).toBeUndefined();
    expect(byId(out, "b").interpolationOut).toBe("auto-bezier");
  });

  it("an ease preset on an auto-bezier key replaces the segment and clears both owners' tags", () => {
    const auto = applyKeyframeInterpolation(three(), ["a", "b", "c"], "auto-bezier");
    const preset = { in: { x: 0.42, y: 0 }, out: { x: 1, y: 1 } };
    const out = edit(auto, "b", { easing: "bezier", bezierHandles: preset });
    expect(byId(out, "b").bezierHandles).toEqual(preset);
    expect(byId(out, "b").interpolationOut).toBeUndefined();
    expect(byId(out, "c").interpolationIn).toBeUndefined();
    const lin = edit(auto, "b", { easing: "linear", bezierHandles: undefined });
    expect(byId(lin, "b").easing).toBe("linear");
    expect(byId(lin, "b").interpolationOut).toBeUndefined();
  });

  it("any path that changes easing drops a stale tag (no label/curve disagreement)", () => {
    const auto = applyKeyframeInterpolation([kf("a", 0, 0), kf("b", 1, 1), kf("c", 2, 3)], ["b"], "auto-bezier");
    const out = edit(auto, "b", { easing: "ease-in" });
    expect(byId(out, "b").interpolationOut).toBeUndefined();
    expect(keyframeSideTypes(byId(out, "a"), byId(out, "b")).out).toBe("ease-in");
  });

  it("continuous keys keep their link on a handle drag and mirror the other side", () => {
    const cont = applyKeyframeInterpolation(three(), ["b"], "continuous-bezier");
    const b = byId(cont, "b");
    const handles = { in: { x: 1 / 3, y: 0.9 }, out: b.bezierHandles?.out ?? { x: 2 / 3, y: 2 / 3 } };
    const out = edit(cont, "b", { easing: "bezier", bezierHandles: handles });
    const na = byId(out, "a") as Keyframe & { value: number }, nb = byId(out, "b") as Keyframe & { value: number }, nc = byId(out, "c") as Keyframe & { value: number };
    expect(nb.interpolationIn).toBe("continuous-bezier");
    expect(nb.interpolationOut).toBe("continuous-bezier");
    const tout = segmentTangents(nb, nc, effectiveBezierHandles(nb)!).out;
    expect(segmentTangents(na, nb, effectiveBezierHandles(na)!).in).toBeCloseTo(tout, 6);
    // Dragging the entering handle instead drives the outgoing one.
    const fromIn = edit(cont, "a", { easing: "bezier", bezierHandles: { in: byId(cont, "a").bezierHandles?.in ?? { x: 1 / 3, y: 1 / 3 }, out: { x: 0.6, y: 0.4 } } });
    const fa = byId(fromIn, "a") as Keyframe & { value: number }, fb = byId(fromIn, "b") as Keyframe & { value: number }, fc = byId(fromIn, "c") as Keyframe & { value: number };
    expect(fa.bezierHandles!.out).toEqual({ x: 0.6, y: 0.4 });
    expect(segmentTangents(fb, fc, effectiveBezierHandles(fb)!).out).toBeCloseTo(segmentTangents(fa, fb, effectiveBezierHandles(fa)!).in, 6);
  });

  it("time and value changes re-derive auto keys; legacy keys untouched", () => {
    const auto = applyKeyframeInterpolation(three(), ["a", "b", "c"], "auto-bezier");
    const moved = refreshSmoothKeyframesAfterEdit(auto, auto.map(k => (k.id === "c" ? { ...k, value: 2 } : k)));
    expect(byId(moved, "b").bezierHandles).not.toEqual(byId(auto, "b").bezierHandles);
    const legacy = three();
    expect(refreshSmoothKeyframesAfterEdit(legacy, legacy)).toEqual(legacy);
  });
});
