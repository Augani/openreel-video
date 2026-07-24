import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "@openreel/core";
import {
  DEFAULT_MOTION_TRANSFORM,
  createMotionParticleLayer,
  createMotionLight,
  getMotionMaskKeyframeProperty,
} from "@openreel/core";
import {
  getMotionStagePlaybackPreviewSettings,
  getMotionStagePreviewCanvasSize,
  getMotionStagePreviewFrameStepSeconds,
  getMotionStagePreviewRenderQuality,
  layerUsesRendererPreview,
  needsRendererBackedStagePreview,
  normalizeMotionStagePreviewSettings,
  shouldUseRendererBackedStagePreview,
} from "./stage-preview-mode";

const baseShape = (id: string): MotionLayer => ({
  id,
  type: "shape",
  name: id,
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 100,
  height: 100,
  style: {
    fill: { type: "solid", color: "#ffffff", opacity: 1 },
    stroke: { color: "#ffffff", width: 0, opacity: 0 },
    cornerRadius: 0,
  },
});

const composition = (
  id: string,
  layers: readonly MotionLayer[],
): MotionComposition => ({
  id,
  name: id,
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [...layers],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 0,
  modifiedAt: 0,
});

describe("stage preview mode", () => {
  it("uses DOM preview for simple editable layer stacks", () => {
    const scene = composition("scene", [baseShape("shape-1")]);

    expect(needsRendererBackedStagePreview(scene, [scene])).toBe(false);
  });

  it("uses renderer preview for post-composite group effects and blend modes", () => {
    const groupWithEffect: MotionLayer = {
      id: "group",
      type: "group",
      name: "Group",
      startTime: 0,
      duration: 5,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      children: ["shape-1"],
      effects: [
        {
          id: "invert",
          type: "invert",
          name: "Invert",
          enabled: true,
          amount: 1,
        },
      ],
    };
    const scene = composition("group-scene", [
      { ...baseShape("shape-1"), parentId: "group" },
      groupWithEffect,
    ]);

    expect(layerUsesRendererPreview(groupWithEffect)).toBe(true);
    expect(needsRendererBackedStagePreview(scene, [scene])).toBe(true);
    expect(
      layerUsesRendererPreview({
        ...groupWithEffect,
        effects: [],
        blendMode: "multiply",
      }),
    ).toBe(true);
  });

  it("uses renderer preview for track mattes and adjustment layers", () => {
    const fill = {
      ...baseShape("fill"),
      trackMatte: {
        enabled: true,
        sourceLayerId: "matte",
        type: "alpha" as const,
      },
    };
    const matteScene = composition("matte-scene", [fill, baseShape("matte")]);
    const adjustmentScene = composition("adjustment-scene", [
      {
        id: "adjustment",
        type: "adjustment",
        name: "Adjustment",
        startTime: 0,
        duration: 5,
        visible: true,
        locked: false,
        transform: DEFAULT_MOTION_TRANSFORM,
        keyframes: [],
        width: 1920,
        height: 1080,
      },
    ]);

    expect(needsRendererBackedStagePreview(matteScene, [matteScene])).toBe(true);
    expect(needsRendererBackedStagePreview(adjustmentScene, [adjustmentScene])).toBe(
      true,
    );
  });

  it("uses renderer preview when masks need soft alpha compositing", () => {
    const scene = composition("scene", [
      {
        ...baseShape("card"),
        masks: [
          {
            id: "mask-1",
            name: "Soft spotlight",
            enabled: true,
            shape: "ellipse",
            mode: "add",
            inverted: false,
            x: 0.1,
            y: 0.1,
            width: 0.8,
            height: 0.8,
            rotation: 0,
            expansion: 0,
            feather: 32,
            opacity: 0.85,
          },
        ],
      },
    ]);

    expect(needsRendererBackedStagePreview(scene, [scene])).toBe(true);
  });

  it("routes plain add path masks to the renderer-backed preview", () => {
    const card: MotionLayer = {
      ...baseShape("card"),
      masks: [
        {
          id: "mask-path",
          name: "Path Mask",
          enabled: true,
          shape: "path",
          mode: "add",
          inverted: false,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          rotation: 0,
          expansion: 0,
          feather: 0,
          opacity: 1,
          pathPoints: [
            { x: 0, y: -80 },
            { x: 80, y: 60 },
            { x: -80, y: 60 },
          ],
        },
      ],
    };

    expect(layerUsesRendererPreview(card)).toBe(true);
  });

  it("uses renderer preview when mask alpha is animated", () => {
    const scene = composition("scene", [
      {
        ...baseShape("card"),
        masks: [
          {
            id: "mask-1",
            name: "Reveal",
            enabled: true,
            shape: "rectangle",
            mode: "add",
            inverted: false,
            x: 0.1,
            y: 0.1,
            width: 0.8,
            height: 0.8,
            rotation: 0,
            expansion: 0,
            feather: 0,
            opacity: 1,
          },
        ],
        keyframes: [
          {
            id: "kf-1",
            property: getMotionMaskKeyframeProperty("mask-1", "opacity"),
            time: 0,
            value: 1,
            easing: "linear",
          },
          {
            id: "kf-2",
            property: getMotionMaskKeyframeProperty("mask-1", "opacity"),
            time: 1,
            value: 0.5,
            easing: "linear",
          },
        ],
      },
    ]);

    expect(needsRendererBackedStagePreview(scene, [scene])).toBe(true);
  });

  it("detects advanced compositing inside nested precomps without looping forever", () => {
    const nestedFill = {
      ...baseShape("nested-fill"),
      trackMatte: {
        enabled: true,
        sourceLayerId: "nested-matte",
        type: "luma" as const,
      },
    };
    const nested = composition("nested", [nestedFill, baseShape("nested-matte")]);
    const host = composition("host", [
      {
        id: "precomp-layer",
        type: "composition",
        name: "Nested",
        startTime: 0,
        duration: 5,
        visible: true,
        locked: false,
        transform: DEFAULT_MOTION_TRANSFORM,
        keyframes: [],
        compositionId: "nested",
        width: 1920,
        height: 1080,
        timeOffset: 0,
        playbackRate: 1,
      },
    ]);

    expect(needsRendererBackedStagePreview(host, [host, nested])).toBe(true);
  });

  it("uses renderer preview when 3D transform controls affect export output", () => {
    const scene = composition("scene", [
      {
        ...baseShape("card"),
        transform: {
          ...DEFAULT_MOTION_TRANSFORM,
          rotation3d: { x: 0, y: 42 },
        },
      },
    ]);

    expect(needsRendererBackedStagePreview(scene, [scene])).toBe(true);
  });

  it("uses renderer preview when the active camera changes the scene view", () => {
    const scene = {
      ...composition("scene", [baseShape("card")]),
      camera: {
        enabled: true,
        position: { x: 860, y: 540, z: 0 },
        zoom: 1.2,
        rotation: 4,
        perspective: 1000,
      },
    };

    expect(needsRendererBackedStagePreview(scene, [scene])).toBe(true);
  });

  it("uses renderer preview when scene lights affect layer shading", () => {
    const base = composition("scene", [baseShape("card")]);
    const scene = {
      ...base,
      lights: [createMotionLight("point", base)],
    };

    expect(needsRendererBackedStagePreview(scene, [scene])).toBe(true);
  });

  it("uses renderer preview for procedural particle layers", () => {
    const scene = composition("scene", [
      createMotionParticleLayer(
        { width: 1920, height: 1080, duration: 5 },
        { id: "particles" },
      ),
    ]);

    expect(needsRendererBackedStagePreview(scene, [scene])).toBe(true);
  });

  it("keeps draft preview on the editable DOM path even for advanced scenes", () => {
    const scene = {
      ...composition("scene", [baseShape("card")]),
      camera: {
        enabled: true,
        position: { x: 960, y: 540, z: 0 },
        zoom: 1.2,
        rotation: 0,
        perspective: 1000,
      },
    };

    expect(
      shouldUseRendererBackedStagePreview(scene, [scene], {
        mode: "final",
        resolution: "full",
      }),
    ).toBe(true);
    expect(
      shouldUseRendererBackedStagePreview(scene, [scene], {
        mode: "draft",
        resolution: "quarter",
      }),
    ).toBe(false);
  });

  it("normalizes preview settings and derives canvas scale", () => {
    expect(normalizeMotionStagePreviewSettings({})).toEqual({
      mode: "final",
      resolution: "full",
    });
    expect(
      normalizeMotionStagePreviewSettings({
        mode: "draft",
        resolution: "quarter",
      }),
    ).toEqual({ mode: "draft", resolution: "quarter" });
    expect(getMotionStagePreviewCanvasSize(1920, 1080, "half")).toEqual({
      width: 960,
      height: 540,
      scale: 0.5,
    });
  });

  it("drops shadows and reflections as preview quality lowers", () => {
    expect(getMotionStagePreviewRenderQuality("full")).toEqual({
      shadows: true,
      shadowMapSize: 2048,
      environment: true,
    });
    expect(getMotionStagePreviewRenderQuality("half")).toMatchObject({
      shadows: true,
      shadowMapSize: 1024,
    });
    const performance = getMotionStagePreviewRenderQuality("quarter");
    expect(performance.shadows).toBe(false);
    expect(performance.environment).toBe(false);
  });

  it("caps playback to the timeline fps and skips frames at lower fidelity", () => {
    expect(
      getMotionStagePreviewFrameStepSeconds(30, {
        mode: "final",
        resolution: "full",
      }),
    ).toBeCloseTo(1 / 30);
    expect(
      getMotionStagePreviewFrameStepSeconds(30, {
        mode: "draft",
        resolution: "quarter",
      }),
    ).toBeCloseTo(4 / 30);
    expect(
      getMotionStagePreviewFrameStepSeconds(60, {
        mode: "final",
        resolution: "half",
      }),
    ).toBeCloseTo(2 / 60);
  });

  it("adapts full-resolution playback without lowering paused quality", () => {
    expect(
      getMotionStagePlaybackPreviewSettings(
        { mode: "final", resolution: "full" },
        true,
      ),
    ).toEqual({ mode: "final", resolution: "half" });
    expect(
      getMotionStagePlaybackPreviewSettings(
        { mode: "final", resolution: "full" },
        false,
      ),
    ).toEqual({ mode: "final", resolution: "full" });
    expect(
      getMotionStagePlaybackPreviewSettings(
        { mode: "draft", resolution: "quarter" },
        true,
      ),
    ).toEqual({ mode: "draft", resolution: "quarter" });
  });
});
