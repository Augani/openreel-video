import { describe, it, expect } from "vitest";
import { ALL_PRESETS } from ".";

describe("preset behaviors", () => {
  const expectedIds = [
    "preset.fire-aura.v1",
    "preset.sparkles.face.v1",
    "preset.ghost-trail.v1",
    "preset.clone.three.v1",
    "preset.aura-glow.v1",
    "preset.background-replace.v1",
    "preset.face-tint.v1",
    "preset.warm-look.v1",
    "preset.cinematic-bars.v1",
    "preset.dreamy.v1",
  ];

  it("exports 10 presets", () => {
    expect(ALL_PRESETS).toHaveLength(10);
    expect(ALL_PRESETS.map((p) => p.id).sort()).toEqual([...expectedIds].sort());
  });

  it("every preset's defaultParams parses against its own schema", () => {
    for (const def of ALL_PRESETS) {
      const r = def.paramSchema.safeParse(def.defaultParams);
      expect(r.success, `${def.id} defaults invalid`).toBe(true);
    }
  });

  it("every preset emits a non-empty fragment with a real output port and declared inputPorts", () => {
    const ctx = { uniqueId: (p: string) => `${p}-1`, paramRef: (id: string) => `param.${id}` };
    for (const def of ALL_PRESETS) {
      const kind = def.acceptsSubjects[0];
      const subject = { id: "s", kind, name: "S", visible: true, behaviors: [] };
      const frag = def.emit(ctx, subject, def.defaultParams);
      expect(frag.nodes.length, `${def.id} has no nodes`).toBeGreaterThan(0);
      expect(frag.outputPort.node, `${def.id} output unset`).toBeTruthy();
      const ids = new Set(frag.nodes.map((n) => n.id));
      expect(ids.has(frag.outputPort.node), `${def.id} outputPort.node not in fragment`).toBe(true);
      expect(Array.isArray(frag.inputPorts), `${def.id} missing inputPorts`).toBe(true);
      for (const ip of frag.inputPorts) {
        expect(ids.has(ip.node), `${def.id} inputPort node ${ip.node} not in fragment`).toBe(true);
      }
    }
  });

  it("subject-specific presets accept only the right kinds", () => {
    const find = (id: string) => ALL_PRESETS.find((p) => p.id === id)!;
    expect(find("preset.sparkles.face.v1").acceptsSubjects).toEqual(["face"]);
    expect(find("preset.face-tint.v1").acceptsSubjects).toEqual(["face"]);
    expect(find("preset.fire-aura.v1").acceptsSubjects).toEqual(["subject_silhouette"]);
    expect(find("preset.warm-look.v1").acceptsSubjects).toEqual(["full_frame"]);
    expect(find("preset.dreamy.v1").acceptsSubjects).toEqual(["full_frame"]);
    expect(find("preset.cinematic-bars.v1").acceptsSubjects).toEqual(["full_frame"]);
  });
});
