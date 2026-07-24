import { describe, expect, it } from "vitest";
import type { MotionComposition } from "@openreel/core";
import { IDENTITY_TRANSFORM } from "@openreel/core/creation/index";
import type {
  CreationAssetRecipe,
  CreationProjectState,
  CreationScene,
} from "@openreel/core/creation/index";
import {
  previewPixelsHaveForeground,
  renderCreationStagePreviewFallbackImage,
  resolveCreationStagePreviewFallback,
} from "./creation-stage-preview";

function asset(): CreationAssetRecipe {
  return {
    id: "asset-red",
    name: "Red asset",
    kind: "prop",
    seed: "asset-red",
    parameters: {},
    nodes: [],
    materials: [
      {
        id: "mat-red",
        name: "Red material",
        model: "pbr",
        baseColor: "#ff3045",
      },
    ],
    dependencies: [],
    caches: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function scene(): CreationScene {
  return {
    id: "scene-1",
    name: "Bound Scene",
    duration: 4,
    frameRate: 30,
    objects: [
      {
        id: "object-red",
        name: "Red object",
        assetId: "asset-red",
        materialId: "mat-red",
        transform: IDENTITY_TRANSFORM,
        visible: true,
        selectable: true,
        tags: ["agent-created"],
      },
    ],
    cameras: [
      {
        id: "camera-1",
        name: "Camera",
        position: { x: 0, y: 1.6, z: 5 },
        target: { x: 0, y: 0, z: 0 },
        fov: 35,
      },
    ],
    activeCameraId: "camera-1",
    lights: [],
    animations: [],
    environment: { kind: "studio", backgroundColor: "#06111f" },
    renderBindings: [
      {
        id: "binding-1",
        kind: "motion-scene3d",
        compositionId: "comp-1",
        layerId: "layer-1",
        objectBindings: [
          { sceneObjectId: "object-red", renderObjectId: "render-red" },
        ],
        createdAt: 1,
        modifiedAt: 1,
      },
    ],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function animatedScene(): CreationScene {
  const base = scene();
  return {
    ...base,
    animations: [
      {
        id: "clip-move",
        name: "Move red object",
        duration: 2,
        tracks: [
          {
            id: "track-move",
            targetId: "object-red",
            channel: "position",
            keyframes: [
              { time: 0, value: { x: -1, y: 0, z: 0 }, easing: "linear" },
              { time: 2, value: { x: 1, y: 0, z: 0 }, easing: "linear" },
            ],
          },
        ],
      },
    ],
  };
}

function creationState(): CreationProjectState {
  return {
    version: "0.1.0",
    assets: [asset()],
    scenes: [scene()],
    activeSceneId: "scene-1",
    operationHistory: [],
  };
}

function animatedCreationState(): CreationProjectState {
  return {
    ...creationState(),
    scenes: [animatedScene()],
  };
}

function composition(): MotionComposition {
  return {
    id: "comp-1",
    name: "Bound Motion Scene",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#06111f",
    layers: [
      {
        id: "layer-1",
        type: "scene3d",
        name: "3D",
        startTime: 0,
        duration: 4,
        visible: true,
        locked: false,
        transform: {
          position: { x: 960, y: 540 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        keyframes: [],
        object: { kind: "box" },
        objects: [
          {
            id: "render-red",
            name: "Red object",
            object: { kind: "sphere" },
            material: { kind: "physical", color: "#ff3045" },
            transform3d: IDENTITY_TRANSFORM,
          },
        ],
      },
    ],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe("creation stage preview fallback", () => {
  it("resolves a creation scene bound to the active scene3d composition", () => {
    const fallback = resolveCreationStagePreviewFallback(
      creationState(),
      composition(),
    );

    expect(fallback?.scene.id).toBe("scene-1");
    expect(fallback?.assets).toHaveLength(1);
  });

  it("renders a CPU fallback image with visible scene coverage", () => {
    const fallback = resolveCreationStagePreviewFallback(
      creationState(),
      composition(),
    );
    expect(fallback).toBeTruthy();

    const image = renderCreationStagePreviewFallbackImage({
      fallback: fallback!,
      width: 320,
      height: 180,
      background: "#06111f",
    });

    expect(image?.coveredPixels).toBeGreaterThan(0);
    expect(
      previewPixelsHaveForeground({
        rgba: image!.rgba,
        width: image!.width,
        height: image!.height,
        background: "#06111f",
      }),
    ).toBe(true);
  });

  it("renders the CPU fallback at the requested animation time", () => {
    const fallback = resolveCreationStagePreviewFallback(
      animatedCreationState(),
      composition(),
    );
    expect(fallback).toBeTruthy();

    const first = renderCreationStagePreviewFallbackImage({
      fallback: fallback!,
      width: 320,
      height: 180,
      background: "#06111f",
      timeSeconds: 0,
    });
    const second = renderCreationStagePreviewFallbackImage({
      fallback: fallback!,
      width: 320,
      height: 180,
      background: "#06111f",
      timeSeconds: 2,
    });

    expect(first?.coveredPixels).toBeGreaterThan(0);
    expect(second?.coveredPixels).toBeGreaterThan(0);
    expect(first!.rgba.some((value, index) => value !== second!.rgba[index])).toBe(
      true,
    );
  });

  it("detects background-only preview pixels", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 6;
      pixels[i + 1] = 17;
      pixels[i + 2] = 31;
      pixels[i + 3] = 255;
    }

    expect(
      previewPixelsHaveForeground({
        rgba: pixels,
        width: 4,
        height: 4,
        background: "#06111f",
      }),
    ).toBe(false);

    for (let i = 0; i < 8 * 4; i += 4) {
      pixels[i] = 255;
      pixels[i + 1] = 48;
      pixels[i + 2] = 69;
    }

    expect(
      previewPixelsHaveForeground({
        rgba: pixels,
        width: 4,
        height: 4,
        background: "#06111f",
      }),
    ).toBe(true);
  });
});
