import { describe, expect, it } from "vitest";
import type { MotionComposition } from "@openreel/core";
import { IDENTITY_TRANSFORM } from "@openreel/core/creation/index";
import type {
  CreationAssetRecipe,
  CreationProjectState,
  CreationScene,
} from "@openreel/core/creation/index";
import { summarizeCreationWorkspace } from "./creation-workspace";

function asset(id: string, dirty = false): CreationAssetRecipe {
  return {
    id,
    name: id,
    kind: "prop",
    seed: id,
    parameters: {},
    nodes: [],
    materials: [{ id: `${id}-mat`, name: "Mat", model: "pbr", baseColor: "#fff" }],
    dependencies: [],
    caches: dirty
      ? [{ id: `${id}-cache`, kind: "preview-mesh", status: "dirty" }]
      : [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function scene(overrides: Partial<CreationScene> = {}): CreationScene {
  return {
    id: "scene-1",
    name: "Agent Scene",
    duration: 4,
    frameRate: 30,
    objects: [
      {
        id: "object-1",
        name: "Object",
        assetId: "asset-1",
        materialId: "asset-1-mat",
        transform: IDENTITY_TRANSFORM,
        visible: true,
        selectable: true,
        tags: ["agent-created"],
      },
    ],
    cameras: [
      { id: "camera-1", name: "Camera", position: { x: 0, y: 0, z: 4 }, target: { x: 0, y: 0, z: 0 }, fov: 35 },
    ],
    lights: [{ id: "light-1", name: "Key", kind: "directional", color: "#fff", intensity: 1 }],
    animations: [],
    environment: { kind: "studio" },
    renderBindings: [
      {
        id: "binding-1",
        kind: "motion-scene3d",
        compositionId: "comp-1",
        layerId: "layer-1",
        objectBindings: [{ sceneObjectId: "object-1", renderObjectId: "render-1" }],
        createdAt: 1,
        modifiedAt: 1,
      },
    ],
    createdAt: 1,
    modifiedAt: 1,
    ...overrides,
  };
}

function creation(
  scenes: readonly CreationScene[],
  assets: readonly CreationAssetRecipe[] = [asset("asset-1", true)],
): CreationProjectState {
  return {
    version: "0.1.0",
    assets,
    scenes,
    activeSceneId: scenes[0]?.id,
    operationHistory: [],
  };
}

function composition(layers: MotionComposition["layers"]): MotionComposition {
  return {
    id: "comp-1",
    name: "Render Comp",
    width: 1920,
    height: 1080,
    duration: 4,
    frameRate: 30,
    backgroundColor: "#000",
    layers,
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe("summarizeCreationWorkspace", () => {
  it("reports recoverable rendered scene3d layers even before creation state exists", () => {
    const summary = summarizeCreationWorkspace(undefined, [
      composition([
        {
          id: "layer-recover",
          type: "scene3d",
          name: "Rendered Agent Scene",
          startTime: 0,
          duration: 4,
          visible: true,
          locked: false,
          transform: { position: { x: 960, y: 540 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
          keyframes: [],
          object: { kind: "box" },
          objects: [
            {
              id: "render-1",
              name: "Recovered Object",
              object: { kind: "sphere" },
            },
          ],
        },
      ]),
    ]);

    expect(summary.available).toBe(false);
    expect(summary.sceneCount).toBe(0);
    expect(summary.recoverableScene3DLayers).toEqual([
      {
        compositionId: "comp-1",
        compositionName: "Render Comp",
        layerId: "layer-recover",
        layerName: "Rendered Agent Scene",
        objectCount: 1,
        duration: 4,
      },
    ]);
  });

  it("reports render-ready creation scenes with dirty-cache guidance", () => {
    const summary = summarizeCreationWorkspace(
      creation([scene()]),
      [
        composition([
          {
            id: "layer-1",
            type: "scene3d",
            name: "3D",
            startTime: 0,
            duration: 4,
            visible: true,
            locked: false,
            transform: { position: { x: 960, y: 540 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
            keyframes: [],
            object: { kind: "box" },
          },
        ]),
      ],
    );

    expect(summary.available).toBe(true);
    expect(summary.scenes[0]?.renderStatus).toBe("ready");
    expect(summary.scenes[0]?.cameras).toEqual([
      {
        cameraId: "camera-1",
        name: "Camera",
        active: false,
        position: { x: 0, y: 0, z: 4 },
        target: { x: 0, y: 0, z: 0 },
        fov: 35,
        focusDistance: undefined,
        depthOfField: undefined,
      },
    ]);
    expect(summary.scenes[0]?.dirtyAssetCount).toBe(1);
    expect(summary.scenes[0]?.issues.map((issue) => issue.code)).toContain("DIRTY_MESH_CACHE");
  });

  it("detects stale or partial render bindings", () => {
    const partial = scene({
      objects: [
        ...scene().objects,
        {
          id: "object-2",
          name: "Unbound",
          assetId: "asset-1",
          transform: IDENTITY_TRANSFORM,
          visible: true,
          selectable: true,
          tags: [],
        },
      ],
    });
    const summary = summarizeCreationWorkspace(
      creation([partial, scene({ id: "missing", renderBindings: [scene().renderBindings[0]!] })]),
      [composition([])],
    );

    expect(summary.scenes[0]?.renderStatus).toBe("missing-layer");
    expect(summary.scenes[1]?.renderStatus).toBe("missing-layer");

    const readyLayerSummary = summarizeCreationWorkspace(
      creation([partial]),
      [
        composition([
          {
            id: "layer-1",
            type: "scene3d",
            name: "3D",
            startTime: 0,
            duration: 4,
            visible: true,
            locked: false,
            transform: { position: { x: 960, y: 540 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
            keyframes: [],
            object: { kind: "box" },
          },
        ]),
      ],
    );
    expect(readyLayerSummary.scenes[0]?.renderStatus).toBe("partial");
    expect(readyLayerSummary.scenes[0]?.issues.map((issue) => issue.code)).toContain("PARTIAL_RENDER_BINDING");
  });

  it("summarizes creation animation clips and character rig render bindings", () => {
    const armAsset: CreationAssetRecipe = {
      ...asset("asset-arm"),
      kind: "character",
      parameters: {
        characterId: "character-astro",
        characterStyle: "astronaut",
        characterBone: "upper_arm.R",
        character: {
          characterId: "character-astro",
          style: "astronaut",
          bone: "upper_arm.R",
        },
      },
      nodes: [
        {
          id: "node-arm-rig",
          type: "skeleton",
          name: "Arm rig",
          inputs: [],
          parameters: {},
        },
      ],
    };
    const handAsset: CreationAssetRecipe = {
      ...asset("asset-hand"),
      kind: "character",
      parameters: {
        characterId: "character-astro",
        characterStyle: "astronaut",
        characterBone: "hand.R",
      },
    };
    const animatedScene = scene({
      objects: [
        {
          id: "object-arm",
          name: "Right arm",
          assetId: "asset-arm",
          materialId: "asset-arm-mat",
          transform: IDENTITY_TRANSFORM,
          visible: true,
          selectable: true,
          tags: ["agent-created", "character", "character-astro", "upper_arm.R"],
        },
        {
          id: "object-hand",
          name: "Right hand",
          assetId: "asset-hand",
          materialId: "asset-hand-mat",
          transform: IDENTITY_TRANSFORM,
          visible: true,
          selectable: true,
          tags: ["agent-created", "character", "character-astro", "hand.R"],
        },
      ],
      animations: [
        {
          id: "clip-wave",
          name: "Wave pose",
          duration: 2,
          tracks: [
            {
              id: "track-arm-rotation",
              targetId: "object-arm",
              channel: "rotation",
              keyframes: [
                { time: 0.2, value: { x: 0, y: 0, z: 0 }, easing: "ease" },
                { time: 1.1, value: { x: 0, y: 0, z: 22 }, easing: "ease-out" },
              ],
            },
            {
              id: "track-hand-rotation",
              targetId: "object-hand",
              channel: "rotation",
              keyframes: [
                { time: 0.3, value: { x: 0, y: 0, z: 0 }, easing: "ease" },
                { time: 1, value: { x: 0, y: 0, z: 35 }, easing: "ease-out" },
              ],
            },
            {
              id: "track-camera-fov",
              targetId: "camera-1",
              channel: "camera.fov",
              keyframes: [
                { time: 0, value: 42, easing: "ease" },
                { time: 1.2, value: 30, easing: "ease-in" },
              ],
            },
          ],
        },
      ],
      renderBindings: [
        {
          ...scene().renderBindings[0]!,
          objectBindings: [{ sceneObjectId: "object-arm", renderObjectId: "render-arm" }],
        },
      ],
    });

    const summary = summarizeCreationWorkspace(
      creation([animatedScene], [armAsset, handAsset]),
      [
        composition([
          {
            id: "layer-1",
            type: "scene3d",
            name: "3D",
            startTime: 0,
            duration: 4,
            visible: true,
            locked: false,
            transform: { position: { x: 960, y: 540 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
            keyframes: [],
            object: { kind: "box" },
          },
        ]),
      ],
    );

    expect(summary.scenes[0]?.animations[0]).toMatchObject({
      clipId: "clip-wave",
      name: "Wave pose",
      trackCount: 3,
      keyframeCount: 6,
      firstTime: 0,
      lastTime: 1.2,
      objectTrackCount: 2,
      cameraTrackCount: 1,
      renderedTrackCount: 2,
    });
    expect(summary.scenes[0]?.animations[0]?.tracks).toMatchObject([
      {
        trackId: "track-arm-rotation",
        targetName: "Right arm",
        targetKind: "object",
        rendered: true,
        valueType: "vec3",
      },
      {
        trackId: "track-hand-rotation",
        targetName: "Right hand",
        targetKind: "object",
        rendered: false,
      },
      {
        trackId: "track-camera-fov",
        targetName: "Camera",
        targetKind: "camera",
        rendered: true,
        valueType: "number",
      },
    ]);
    expect(summary.scenes[0]?.rigs).toEqual([
      {
        rigId: "character-astro",
        name: "astronaut character",
        style: "astronaut",
        partCount: 2,
        renderedPartCount: 1,
        animatedTrackCount: 2,
        bones: ["hand.R", "upper_arm.R"],
      },
    ]);
    expect(summary.scenes[0]?.issues.map((issue) => issue.code)).toContain(
      "UNSYNCED_ANIMATION_TRACK",
    );
  });
});
