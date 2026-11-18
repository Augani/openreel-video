import { describe, it, expect } from "vitest";
import {
  AdjustmentLayerEngine,
  AdjustmentLayerSchedule,
  planAdjustmentLayers,
  trackHasAdjustableContent,
  type AdjustmentLayer,
} from "./adjustment-layer-engine";
import type { Effect } from "../types/timeline";

const effect = { id: "fx", type: "brightness", params: {}, enabled: true } as unknown as Effect;

function layer(overrides: Partial<AdjustmentLayer> = {}): AdjustmentLayer {
  return {
    id: "adj",
    trackId: "t1",
    name: "Adj",
    startTime: 0,
    duration: 10,
    effects: [effect],
    opacity: 1,
    blendMode: "normal",
    enabled: true,
    affectedTracks: "all",
    transform: {} as AdjustmentLayer["transform"],
    ...overrides,
  };
}

// Stack order: index 0 is front-most. t0 = titles (above), t1 = adjustment track, t2/t3 = footage (below).
const tracks = [{ id: "t0" }, { id: "t1" }, { id: "t2" }, { id: "t3" }];

/** Mirrors the renderers' painter loop (highest index first); returns the track ids each layer was applied over. */
function simulatePaint(layers: AdjustmentLayer[], time = 1): Map<string, string[]> {
  const schedule = new AdjustmentLayerSchedule(planAdjustmentLayers(layers, tracks, time));
  const painted: string[] = [];
  const affected = new Map<string, string[]>();
  const record = (id: string, over: string[]) => affected.set(id, [...(affected.get(id) ?? []), ...over]);
  tracks
    .map((track, originalIndex) => ({ track, originalIndex }))
    .reverse()
    .forEach(({ track, originalIndex }) => {
      for (const p of schedule.takeCompositeBefore(originalIndex)) record(p.layer.id, painted);
      for (const p of schedule.scopedFor(track.id)) record(p.layer.id, [track.id]);
      painted.push(track.id);
    });
  for (const p of schedule.takeRemainingComposite()) record(p.layer.id, painted);
  return affected;
}

describe("adjustment layer stacking", () => {
  it("affects only tracks below the layer, never the layer's own track or tracks above", () => {
    const result = simulatePaint([layer()]);
    expect(result.get("adj")).toEqual(["t3", "t2"]);
    expect(result.get("adj")).not.toContain("t0");
    expect(result.get("adj")).not.toContain("t1");
  });

  it("leaves content above untouched when the layer is on the front-most track", () => {
    expect(simulatePaint([layer({ trackId: "t0" })]).get("adj")).toEqual(["t3", "t2", "t1"]);
  });

  it("affects nothing when the layer is on the bottom track", () => {
    expect(simulatePaint([layer({ trackId: "t3" })]).get("adj") ?? []).toEqual([]);
  });

  it("restricts to affectedTracks, ignoring listed tracks above the layer", () => {
    const result = simulatePaint([layer({ affectedTracks: ["t3", "t0", "t1"] })]);
    expect(result.get("adj")).toEqual(["t3"]);
  });

  it("is a no-op when affectedTracks lists no track below the layer", () => {
    expect(planAdjustmentLayers([layer({ affectedTracks: ["t0"] })], tracks, 1)).toEqual([]);
    expect(planAdjustmentLayers([layer({ affectedTracks: [] })], tracks, 1)).toEqual([]);
  });

  it("orders stacked layers lowest first", () => {
    const plan = planAdjustmentLayers(
      [layer({ id: "upper", trackId: "t0" }), layer({ id: "lower", trackId: "t2" })],
      tracks,
      1,
    );
    expect(plan.map((p) => p.layer.id)).toEqual(["lower", "upper"]);
  });

  it("skips disabled, transparent, out-of-range and effect-less layers", () => {
    const plan = planAdjustmentLayers(
      [
        layer({ id: "a", enabled: false }),
        layer({ id: "b", opacity: 0 }),
        layer({ id: "c", startTime: 5 }),
        layer({ id: "d", effects: [{ ...effect, enabled: false } as Effect] }),
        layer({ id: "ok" }),
      ],
      tracks,
      1,
    );
    expect(plan.map((p) => p.layer.id)).toEqual(["ok"]);
  });

  it("treats a layer on an unknown track as topmost over everything rendered", () => {
    expect(simulatePaint([layer({ trackId: "gone" })]).get("adj")).toEqual(["t3", "t2", "t1", "t0"]);
  });

  it("runs a layer on a hidden track before the next visible track at or above it", () => {
    // Renderers skip hidden tracks, so the layer (stack index 1) is released before visible index 0.
    const schedule = new AdjustmentLayerSchedule(planAdjustmentLayers([layer()], tracks, 1));
    expect(schedule.takeCompositeBefore(3)).toEqual([]);
    expect(schedule.takeCompositeBefore(2)).toEqual([]);
    expect(schedule.takeCompositeBefore(0)).toHaveLength(1);
  });
});

describe("AdjustmentLayerEngine.getEffectsForClip", () => {
  it("returns effects for clips below the layer only, honoring affectedTracks", () => {
    const engine = new AdjustmentLayerEngine();
    const created = engine.createAdjustmentLayer("t1", 0, { duration: 10, effects: [effect] });
    const indices = new Map(tracks.map((t, i) => [t.id, i]));
    expect(engine.getEffectsForClip(2, 1, indices)).toHaveLength(1);
    expect(engine.getEffectsForClip(0, 1, indices)).toHaveLength(0);
    expect(engine.getEffectsForClip(1, 1, indices)).toHaveLength(0);
    engine.setAffectedTracks(created.id, ["t3"]);
    expect(engine.getEffectsForClip(2, 1, indices)).toHaveLength(0);
    expect(engine.getEffectsForClip(3, 1, indices)).toHaveLength(1);
  });
});

describe("trackHasAdjustableContent", () => {
  const none = { hasMedia: false, overlays: [], motionInstances: [] };

  it("is false for an empty track", () => {
    expect(trackHasAdjustableContent("t2", 1, none)).toBe(false);
  });

  it("counts media, any overlay kind, and time-active motion instances", () => {
    expect(trackHasAdjustableContent("t2", 1, { ...none, hasMedia: true })).toBe(true);
    expect(trackHasAdjustableContent("t2", 1, { ...none, overlays: [[], [{ trackId: "t2" }]] })).toBe(true);
    expect(trackHasAdjustableContent("t2", 1, { ...none, overlays: [[{ trackId: "t9" }]] })).toBe(false);
    const motion = [{ trackId: "t2", startTime: 0, duration: 2 }];
    expect(trackHasAdjustableContent("t2", 1, { ...none, motionInstances: motion })).toBe(true);
    expect(trackHasAdjustableContent("t2", 5, { ...none, motionInstances: motion })).toBe(false);
    expect(trackHasAdjustableContent("t2", 1, { ...none, motionInstances: [{ startTime: 0, duration: 2 }] })).toBe(false);
  });
});
