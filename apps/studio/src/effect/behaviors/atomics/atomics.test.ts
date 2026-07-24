import { describe, it, expect } from "vitest";
import { ALL_ATOMICS } from ".";

describe("atomic behaviors", () => {
  it("exports 7 atomic behaviors", () => {
    expect(ALL_ATOMICS).toHaveLength(7);
    const ids = ALL_ATOMICS.map((b) => b.id).sort();
    expect(ids).toEqual([
      "atomic.blur",
      "atomic.color-tint",
      "atomic.distort",
      "atomic.glow",
      "atomic.mask-edge",
      "atomic.particles",
      "atomic.replace",
    ]);
  });

  for (const expectedKind of [
    "glow",
    "particles",
    "color-tint",
    "blur",
    "replace",
    "distort",
    "mask-edge",
  ] as const) {
    it(`${expectedKind}: defaultParams parses against own schema`, () => {
      const def = ALL_ATOMICS.find((b) => b.atomicKind === expectedKind);
      expect(def, `missing ${expectedKind}`).toBeDefined();
      const result = def!.paramSchema.safeParse(def!.defaultParams);
      expect(result.success).toBe(true);
    });
  }

  it("each atomic emits a non-empty GraphFragment with declared inputPorts", () => {
    const ctx = { uniqueId: (p: string) => `${p}-1`, paramRef: (id: string) => `param.${id}` };
    const subject = { id: "s", kind: "full_frame" as const, name: "F", visible: true, behaviors: [] };
    for (const def of ALL_ATOMICS) {
      const valid = def.acceptsSubjects.includes("full_frame")
        ? subject
        : { ...subject, kind: def.acceptsSubjects[0] };
      const frag = def.emit(ctx, valid, def.defaultParams);
      expect(frag.nodes.length, `${def.id} has 0 nodes`).toBeGreaterThan(0);
      expect(frag.outputPort.node, `${def.id} has no output port node`).toBeTruthy();
      expect(Array.isArray(frag.inputPorts), `${def.id} missing inputPorts`).toBe(true);
      const nodeIds = new Set(frag.nodes.map((n) => n.id));
      for (const ip of frag.inputPorts) {
        expect(nodeIds.has(ip.node), `${def.id} inputPort node ${ip.node} not in fragment`).toBe(true);
      }
      expect(nodeIds.has(frag.outputPort.node), `${def.id} outputPort.node not in fragment`).toBe(true);
    }
  });

  it("blur, replace, mask-edge restrict subject kinds correctly", () => {
    const find = (id: string) => ALL_ATOMICS.find((b) => b.atomicKind === id)!;
    expect(find("blur").acceptsSubjects).toEqual(expect.arrayContaining(["subject_silhouette", "full_frame"]));
    expect(find("blur").acceptsSubjects).not.toContain("face");
    expect(find("replace").acceptsSubjects).toEqual(expect.arrayContaining(["subject_silhouette", "full_frame"]));
    expect(find("replace").acceptsSubjects).not.toContain("face");
    expect(find("mask-edge").acceptsSubjects).toEqual(expect.arrayContaining(["face", "subject_silhouette"]));
    expect(find("mask-edge").acceptsSubjects).not.toContain("full_frame");
  });
});
