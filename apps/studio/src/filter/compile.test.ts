import { describe, it, expect } from "vitest";
import { filterDocToGraph } from "./compile";
import { emptyFilterDoc, addAdjustment } from "./store";
import { registerAllBehaviors, getBehavior } from "../effect/behaviors/registry";

registerAllBehaviors();

describe("filterDocToGraph", () => {
  it("compiles a FilterDoc by treating it as a single Full Frame subject", () => {
    const warm = getBehavior("preset.warm-look.v1")!;
    let doc = emptyFilterDoc();
    doc = addAdjustment(doc, {
      id: "a-1", kind: "preset", presetId: warm.id, params: warm.defaultParams as Record<string, unknown>, name: warm.label, visible: true,
    });
    const result = filterDocToGraph(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.kind).toBe("filter");
    expect(result.graph.nodes.find((n) => n.type === "LUT")).toBeDefined();
  });

  it("rejects an adjustment that doesn't accept full_frame", () => {
    const fire = getBehavior("preset.fire-aura.v1")!;
    let doc = emptyFilterDoc();
    doc = addAdjustment(doc, {
      id: "a-1", kind: "preset", presetId: fire.id, params: fire.defaultParams as Record<string, unknown>, name: fire.label, visible: true,
    });
    const result = filterDocToGraph(doc);
    expect(result.ok).toBe(false);
  });
});
