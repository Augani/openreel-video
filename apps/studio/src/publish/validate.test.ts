import { describe, it, expect } from "vitest";
import { validatePublishable } from "./validate";
import { registerAllBehaviors, getBehavior } from "../effect/behaviors/registry";
import type { Scene } from "../effect/scene";

registerAllBehaviors();

describe("validatePublishable", () => {
  it("rejects when name is empty", () => {
    const scene: Scene = { sampleClipId: "x", subjects: [] };
    const r = validatePublishable({ kind: "effect", name: "", doc: scene });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /name/i.test(e))).toBe(true);
  });

  it("rejects when no subjects/adjustments", () => {
    const scene: Scene = { sampleClipId: "x", subjects: [] };
    const r = validatePublishable({ kind: "effect", name: "My Effect", doc: scene });
    expect(r.ok).toBe(false);
  });

  it("accepts a valid effect with one subject + behavior", () => {
    const sparkles = getBehavior("preset.sparkles.face.v1")!;
    const scene: Scene = {
      sampleClipId: "x",
      subjects: [{
        id: "s", kind: "face", name: "Face", visible: true,
        behaviors: [{ id: "b", kind: "preset", presetId: sparkles.id, params: sparkles.defaultParams as Record<string, unknown>, name: "S", visible: true }],
      }],
    };
    const r = validatePublishable({ kind: "effect", name: "My Effect", doc: scene });
    expect(r.ok).toBe(true);
  });
});
