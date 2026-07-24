import { describe, expect, it } from "vitest";
import { validateCreationScene } from "@openreel/creation-schema";
import { createProductCinematicMotionComposition } from "./creation-product-motion";

describe("createProductCinematicMotionComposition", () => {
  it("translates a semantic product recipe into a renderable Motion Creator scene", () => {
    let keyframeIndex = 0;
    const result = createProductCinematicMotionComposition({
      compositionId: "comp-product",
      layerId: "layer-scene",
      keyframeId: () => `kf-${keyframeIndex++}`,
      name: "iPhone-style product reveal",
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 6,
      includeInternals: true,
      includeCallouts: true,
    });

    expect(validateCreationScene(result.creationScene).filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.composition.id).toBe("comp-product");
    expect(result.composition.layers[0]).toBe(result.layer);
    expect(result.layer.type).toBe("scene3d");
    expect(result.layer.objects?.length).toBeGreaterThan(10);
    expect(result.objectIdsByPartId["part-a-chip"]).toBe("obj-part-a-chip");
    expect(result.calloutLayerIds.length).toBeGreaterThan(0);
    expect(result.composition.layers.length).toBe(1 + result.calloutLayerIds.length);
    expect(result.coreCreationAsset.id).toBe("asset-phone-product");
    expect(
      result.coreCreationScene.objects.some(
        (object) => object.partId === "part-a-chip" && object.materialId === "mat-chip",
      ),
    ).toBe(true);
    expect(result.coreCreationScene.renderBindings[0]).toMatchObject({
      kind: "motion-scene3d",
      compositionId: "comp-product",
      layerId: "layer-scene",
    });
    expect(
      result.coreCreationScene.renderBindings[0]?.objectBindings.some(
        (binding) =>
          binding.sceneObjectId === "object-part-a-chip" &&
          binding.renderObjectId === "obj-part-a-chip",
      ),
    ).toBe(true);
    expect(result.creationOperations.map((operation) => operation.type)).toEqual([
      "asset/upsert",
      "scene/upsert",
      "scene/set-active",
    ]);

    const properties = new Set(result.layer.keyframes.map((keyframe) => keyframe.property));
    expect(properties.has("scene.object.obj-part-a-chip.position.x")).toBe(true);
    expect(properties.has("scene.camera.position.z")).toBe(true);
    expect(properties.has("scene.camera.fov")).toBe(true);

    const calloutLayer = result.composition.layers.find((layer) => layer.id === result.calloutLayerIds[0]);
    expect(calloutLayer?.type).toBe("text");
    expect(calloutLayer?.keyframes.some((keyframe) => keyframe.property === "transform.opacity")).toBe(true);
  });
});
