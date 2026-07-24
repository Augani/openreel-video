import { describe, it, expect } from "vitest";
import { validateGraph } from "@openreel/fxpkg";
import { sceneToGraph } from "./compile";
import { emptyScene, type Scene } from "./scene";
import { registerAllBehaviors, getBehavior } from "./behaviors/registry";

registerAllBehaviors();

function makeScene(): Scene {
  const sparkles = getBehavior("preset.sparkles.face.v1")!;
  const warm = getBehavior("preset.warm-look.v1")!;
  return {
    sampleClipId: "portrait-closeup-01",
    subjects: [
      {
        id: "sub-1",
        kind: "face",
        name: "Face",
        visible: true,
        behaviors: [
          {
            id: "b-1",
            kind: "preset",
            presetId: sparkles.id,
            params: sparkles.defaultParams as Record<string, unknown>,
            name: "Sparkles",
            visible: true,
          },
        ],
      },
      {
        id: "sub-2",
        kind: "full_frame",
        name: "Full frame",
        visible: true,
        behaviors: [
          {
            id: "b-2",
            kind: "preset",
            presetId: warm.id,
            params: warm.defaultParams as Record<string, unknown>,
            name: "Warm",
            visible: true,
          },
        ],
      },
    ],
  };
}

describe("sceneToGraph", () => {
  it("produces a Graph with Source + Output for an empty scene", () => {
    const result = sceneToGraph(emptyScene(), { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes.find((n) => n.type === "Source")).toBeDefined();
    expect(result.graph.nodes.find((n) => n.type === "Output")).toBeDefined();
  });

  it("composes preset fragments into a connected graph that passes fxpkg validation", () => {
    const result = sceneToGraph(makeScene(), { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validation = validateGraph(result.graph);
    expect(validation.ok, JSON.stringify(validation.errors)).toBe(true);
  });

  it("emits exactly one SubjectMask node per scene (shared across silhouette-using fragments)", () => {
    const fireAura = getBehavior("preset.fire-aura.v1")!;
    const ghostTrail = getBehavior("preset.ghost-trail.v1")!;
    const scene: Scene = {
      sampleClipId: "x",
      subjects: [
        {
          id: "s",
          kind: "subject_silhouette",
          name: "S",
          visible: true,
          behaviors: [
            {
              id: "b1",
              kind: "preset",
              presetId: fireAura.id,
              params: fireAura.defaultParams as Record<string, unknown>,
              name: "F",
              visible: true,
            },
            {
              id: "b2",
              kind: "preset",
              presetId: ghostTrail.id,
              params: ghostTrail.defaultParams as Record<string, unknown>,
              name: "G",
              visible: true,
            },
          ],
        },
      ],
    };
    const result = sceneToGraph(scene, { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const maskCount = result.graph.nodes.filter((n) => n.type === "SubjectMask").length;
    expect(maskCount).toBe(1);
  });

  it("invisible subjects' behaviors are skipped", () => {
    const scene = makeScene();
    scene.subjects[0].visible = false;
    const result = sceneToGraph(scene, { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes.find((n) => n.type === "LandmarkEmitter")).toBeUndefined();
  });

  it("invisible behaviors are skipped", () => {
    const scene = makeScene();
    scene.subjects[0].behaviors[0].visible = false;
    const result = sceneToGraph(scene, { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes.find((n) => n.type === "LandmarkEmitter")).toBeUndefined();
  });

  it("returns errors for behaviors whose params fail their schema", () => {
    const scene = makeScene();
    scene.subjects[0].behaviors[0].params = { style: "INVALID" };
    const result = sceneToGraph(scene, { kind: "effect" });
    expect(result.ok).toBe(false);
  });

  it("a single Source and Output node always exist", () => {
    const scene = makeScene();
    const result = sceneToGraph(scene, { kind: "effect" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes.filter((n) => n.type === "Source")).toHaveLength(1);
    expect(result.graph.nodes.filter((n) => n.type === "Output")).toHaveLength(1);
  });

  it("returns an error when a behavior requires a detector not present in the scene", () => {
    const replace = getBehavior("atomic.replace")!;
    const scene: Scene = {
      sampleClipId: "x",
      subjects: [
        {
          id: "sub-1",
          kind: "full_frame",
          name: "Full frame",
          visible: true,
          behaviors: [
            {
              id: "b-1",
              kind: "atomic",
              atomicKind: "replace",
              params: replace.defaultParams as Record<string, unknown>,
              name: "Replace",
              visible: true,
            },
          ],
        },
      ],
    };
    const result = sceneToGraph(scene, { kind: "effect" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("subject_mask"))).toBe(true);
  });
});
