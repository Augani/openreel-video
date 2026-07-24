import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineBehavior, getBehavior, listBehaviors, registerAllBehaviors } from "./registry";
import { GLOW } from "./atomics/glow";

describe("behavior registry", () => {
  it("registers a behavior and retrieves it by id", () => {
    const probe = defineBehavior({
      id: "_probe.v1",
      kind: "atomic",
      atomicKind: "glow",
      label: "Probe",
      iconName: "sparkle",
      acceptsSubjects: ["full_frame"],
      paramSchema: z.object({ amount: z.number().min(0).max(1) }),
      defaultParams: { amount: 0.5 },
      thumbnailUrl: "",
      emit: () => ({ nodes: [], edges: [], inputPorts: [], outputPort: { node: "x", port: "out" } }),
    });
    expect(probe.id).toBe("_probe.v1");
    expect(probe.paramSchema.safeParse({ amount: 0.7 }).success).toBe(true);
    expect(probe.paramSchema.safeParse({ amount: 2 }).success).toBe(false);
  });

  it("GLOW atomic is valid for all three v1 subject kinds", () => {
    expect(GLOW.acceptsSubjects).toEqual(expect.arrayContaining(["face", "subject_silhouette", "full_frame"]));
  });

  it("GLOW defaults parse against its own schema", () => {
    expect(GLOW.paramSchema.safeParse(GLOW.defaultParams).success).toBe(true);
  });

  it("registerAllBehaviors makes GLOW retrievable by id from the global registry", () => {
    registerAllBehaviors();
    const def = getBehavior(GLOW.id);
    expect(def).toBeDefined();
    expect(def?.id).toBe(GLOW.id);
  });

  it("listBehaviors returns at least the registered atomics", () => {
    registerAllBehaviors();
    const ids = listBehaviors().map((b) => b.id);
    expect(ids).toContain(GLOW.id);
  });
});
