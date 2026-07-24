import { describe, expect, it } from "vitest";
import {
  applyCreationOperation,
  createCreationScene,
  createCreationSceneObject,
  createEmptyCreationState,
  getActiveCreationScene,
  normalizeCreationState,
  summarizeCreationState,
  validateCreationState,
} from "./runtime";
import { transform3d, vec3 } from "./schema/common";
import type {
  CreationAssetRecipe,
  CreationOperation,
  CreationProjectState,
} from "./schema/types";

const asset = (id = "asset-phone"): CreationAssetRecipe => ({
  id,
  name: "Editable phone",
  kind: "product",
  seed: "phone-seed",
  parameters: { productKind: "phone" },
  nodes: [
    {
      id: "node-body",
      type: "primitive",
      name: "Phone body",
      inputs: [],
      parameters: { primitive: "rounded-box", width: 1, height: 2 },
    },
  ],
  materials: [
    {
      id: "mat-glass",
      name: "Glass",
      model: "glass",
      baseColor: "#d8f1ff",
      roughness: 0.04,
      opacity: 0.72,
    },
  ],
  dependencies: [],
  caches: [
    {
      id: "cache-preview-phone",
      kind: "preview-mesh",
      status: "dirty",
    },
  ],
  createdAt: 10,
  modifiedAt: 10,
});

const operation = <T extends CreationOperation>(op: T): T => op;

describe("creation runtime", () => {
  it("applies asset, scene, object, transform, and animation operations immutably", () => {
    const scene = createCreationScene({
      id: "scene-product",
      name: "Product scene",
      duration: 7,
      frameRate: 24,
      now: 10,
    });
    const object = createCreationSceneObject({
      id: "object-phone",
      name: "Phone assembly",
      assetId: "asset-phone",
      tags: ["product", "hero"],
    });

    let state = createEmptyCreationState();
    state = applyCreationOperation(
      state,
      operation({
        id: "op-asset",
        type: "asset/upsert",
        timestamp: 11,
        source: "agent",
        asset: asset(),
      }),
    );
    state = applyCreationOperation(
      state,
      operation({
        id: "op-scene",
        type: "scene/upsert",
        timestamp: 12,
        source: "agent",
        scene,
      }),
    );
    state = applyCreationOperation(
      state,
      operation({
        id: "op-camera",
        type: "camera/upsert",
        timestamp: 12.5,
        source: "agent",
        sceneId: scene.id,
        active: true,
        camera: {
          id: "camera-hero",
          name: "Hero camera",
          position: vec3(0, 2, 6),
          target: vec3(0, 0, 0),
          fov: 35,
        },
      }),
    );
    state = applyCreationOperation(
      state,
      operation({
        id: "op-object",
        type: "scene-object/upsert",
        timestamp: 13,
        source: "agent",
        sceneId: scene.id,
        object,
      }),
    );
    state = applyCreationOperation(
      state,
      operation({
        id: "op-transform",
        type: "scene-object/update-transform",
        timestamp: 14,
        source: "user",
        sceneId: scene.id,
        objectId: object.id,
        transform: transform3d(vec3(1, 2, 3)),
      }),
    );
    state = applyCreationOperation(
      state,
      operation({
        id: "op-material",
        type: "scene-object/update-material",
        timestamp: 14.5,
        source: "agent",
        sceneId: scene.id,
        objectId: object.id,
        materialId: "mat-glass",
      }),
    );
    state = applyCreationOperation(
      state,
      operation({
        id: "op-clip",
        type: "animation/upsert-clip",
        timestamp: 15,
        source: "agent",
        sceneId: scene.id,
        clip: {
          id: "clip-orbit",
          name: "Camera orbit",
          duration: 7,
          tracks: [
            {
              id: "track-object-position",
              targetId: object.id,
              channel: "position",
              keyframes: [
                { time: 0, value: vec3(0, 0, 0), easing: "ease" },
                { time: 1, value: vec3(1, 0, 0), easing: "ease-out" },
              ],
            },
          ],
        },
      }),
    );

    const activeScene = getActiveCreationScene(state);
    expect(activeScene?.activeCameraId).toBe("camera-hero");
    expect(activeScene?.cameras[0]?.fov).toBe(35);
    expect(activeScene?.objects[0]?.transform.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(activeScene?.objects[0]?.materialId).toBe("mat-glass");
    expect(activeScene?.animations).toHaveLength(1);
    expect(state.operationHistory.map((entry) => entry.id)).toEqual([
      "op-asset",
      "op-scene",
      "op-camera",
      "op-object",
      "op-transform",
      "op-material",
      "op-clip",
    ]);
    expect(validateCreationState(state)).toEqual([]);
    expect(summarizeCreationState(state)).toBe("1 asset(s), 1 scene(s), 1 object(s), 1 cache ref(s)");
  });

  it("validates missing references in scene graphs", () => {
    const state: CreationProjectState = {
      ...createEmptyCreationState(),
      activeSceneId: "missing-scene",
      assets: [asset()],
      scenes: [
        {
          ...createCreationScene({ id: "scene-1", name: "Broken", now: 1 }),
          activeCameraId: "missing-camera",
          objects: [
            createCreationSceneObject({
              id: "object-1",
              name: "Broken object",
              assetId: "missing-asset",
              materialId: "missing-material",
              parentId: "missing-parent",
            }),
            createCreationSceneObject({
              id: "object-bad-material",
              name: "Bad material object",
              assetId: "asset-phone",
              materialId: "missing-material",
            }),
          ],
          animations: [
            {
              id: "clip-bad",
              name: "Bad clip",
              duration: 1,
              tracks: [
                {
                  id: "track-bad",
                  targetId: "missing-target",
                  channel: "position",
                  keyframes: [
                    { time: 1, value: vec3(0, 0, 0), easing: "linear" },
                    { time: 0, value: vec3(1, 0, 0), easing: "linear" },
                  ],
                },
              ],
            },
          ],
          renderBindings: [
            {
              id: "binding-bad",
              kind: "motion-scene3d",
              compositionId: "comp-missing",
              layerId: "layer-missing",
              objectBindings: [
                { sceneObjectId: "missing-render-object", renderObjectId: "obj-1" },
              ],
              createdAt: 1,
              modifiedAt: 1,
            },
          ],
        },
      ],
    };

    const codes = validateCreationState(state).map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "ACTIVE_SCENE_NOT_FOUND",
        "OBJECT_ASSET_NOT_FOUND",
        "OBJECT_MATERIAL_NOT_FOUND",
        "OBJECT_PARENT_NOT_FOUND",
        "ACTIVE_CAMERA_NOT_FOUND",
        "ANIMATION_TARGET_NOT_FOUND",
        "KEYFRAMES_NOT_SORTED",
        "RENDER_BINDING_OBJECT_NOT_FOUND",
      ]),
    );
  });

  it("normalizes partially persisted creation state", () => {
    const normalized = normalizeCreationState({
      version: "custom",
      assets: [asset()],
      scenes: [
        {
          ...createCreationScene({ id: "scene-old", name: "Old scene", now: 1 }),
          renderBindings: undefined as never,
        },
      ],
    });

    expect(normalized?.version).toBe("custom");
    expect(normalized?.assets).toHaveLength(1);
    expect(normalized?.scenes[0]?.renderBindings).toEqual([]);
    expect(normalized?.operationHistory).toEqual([]);
  });
});
