import { describe, expect, it } from "vitest";
import type { CreationProjectState } from "./schema/types";
import { resolveCreationMotionSceneBinding } from "./render-binding";

const creationState: CreationProjectState = {
  version: "1.0.0",
  activeSceneId: "scene-bound",
  assets: [
    {
      id: "asset-phone",
      name: "Phone",
      kind: "product",
      seed: "phone-seed",
      parameters: {},
      nodes: [],
      materials: [],
      dependencies: [],
      caches: [],
      createdAt: 1,
      modifiedAt: 1,
    },
  ],
  scenes: [
    {
      id: "scene-other",
      name: "Other",
      duration: 4,
      frameRate: 30,
      objects: [],
      cameras: [],
      lights: [],
      animations: [],
      environment: { kind: "studio" },
      renderBindings: [],
      createdAt: 1,
      modifiedAt: 1,
    },
    {
      id: "scene-bound",
      name: "Bound",
      duration: 4,
      frameRate: 30,
      objects: [],
      cameras: [],
      lights: [],
      animations: [],
      environment: { kind: "studio" },
      renderBindings: [
        {
          id: "binding-hero",
          kind: "motion-scene3d",
          compositionId: "composition-hero",
          layerId: "layer-hero",
          objectBindings: [],
          calloutLayerIds: ["layer-callout"],
          createdAt: 2,
          modifiedAt: 2,
        },
      ],
      createdAt: 2,
      modifiedAt: 2,
    },
  ],
  operationHistory: [],
};

describe("resolveCreationMotionSceneBinding", () => {
  it("returns the matching scene, binding, and asset list", () => {
    const resolved = resolveCreationMotionSceneBinding(
      creationState,
      "composition-hero",
      "layer-hero",
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.scene.id).toBe("scene-bound");
    expect(resolved?.binding.id).toBe("binding-hero");
    expect(resolved?.assets).toBe(creationState.assets);
  });

  it("can match by composition id when the layer id is omitted", () => {
    const resolved = resolveCreationMotionSceneBinding(
      creationState,
      "composition-hero",
    );

    expect(resolved?.binding.layerId).toBe("layer-hero");
  });

  it("returns null when no matching binding exists", () => {
    expect(
      resolveCreationMotionSceneBinding(
        creationState,
        "composition-hero",
        "layer-missing",
      ),
    ).toBeNull();
    expect(
      resolveCreationMotionSceneBinding(undefined, "composition-hero", "layer-hero"),
    ).toBeNull();
  });
});
