import { describe, expect, it, vi } from "vitest";
import { MotionRenderer } from "./motion-renderer";
import { createMotionEffect } from "./motion-effects";
import type {
  MotionComposition,
  MotionEffect,
  MotionGroupLayer,
  MotionScene3DLayer,
  MotionTransform,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

describe("MotionRenderer scene3d rendering", () => {
  it("uses the native scene renderer even when the Three.js fallback is unavailable", async () => {
    const renderer = new MotionRenderer();
    const image = { close: vi.fn() } as unknown as ImageBitmap;
    const release = vi.fn();
    const renderScene3D = vi.fn().mockResolvedValue({ image, release });
    const ctx = {
      drawImage: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const composition: MotionComposition = {
      id: "composition-hero",
      name: "Hero",
      width: 1280,
      height: 720,
      frameRate: 30,
      duration: 4,
      backgroundColor: "#101820",
      layers: [],
      assets: [],
      variables: [],
      markers: [],
      createdAt: 1,
      modifiedAt: 1,
    };
    const layer: MotionScene3DLayer = {
      id: "layer-hero",
      type: "scene3d",
      name: "Hero Layer",
      startTime: 0,
      duration: 4,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      object: {
        kind: "box",
      },
      width: 640,
      height: 360,
    };

    (renderer as unknown as { threeRenderer: { isAvailable(): boolean } }).threeRenderer = {
      isAvailable: () => false,
    };

    await (
      renderer as unknown as {
        renderScene3D(
          ctx: OffscreenCanvasRenderingContext2D,
          composition: MotionComposition,
          layer: MotionScene3DLayer,
          options: { assetResolver: { renderScene3D: typeof renderScene3D } },
          localTime: number,
        ): Promise<void>;
      }
    ).renderScene3D(
      ctx,
      composition,
      layer,
      { assetResolver: { renderScene3D } },
      1.25,
    );

    expect(renderScene3D).toHaveBeenCalledWith({
      composition,
      layer,
      localTime: 1.25,
      width: 640,
      height: 360,
      backgroundColor: "#101820",
      quality: undefined,
    });
    expect(ctx.drawImage).toHaveBeenCalledWith(image, -320, -180, 640, 360);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("post-processes combined group children through the authored effect stack", async () => {
    const renderer = new MotionRenderer();
    const effect = createMotionEffect("invert", "group-invert");
    const group: MotionGroupLayer = {
      id: "group",
      type: "group",
      name: "Group",
      startTime: 0,
      duration: 4,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      children: ["child"],
      effects: [effect],
    };
    const child = {
      id: "child",
      type: "null" as const,
      name: "Child",
      startTime: 0,
      duration: 4,
      visible: true,
      locked: false,
      parentId: group.id,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
    };
    const composition: MotionComposition = {
      id: "group-comp",
      name: "Group Comp",
      width: 320,
      height: 180,
      frameRate: 30,
      duration: 4,
      backgroundColor: "transparent",
      layers: [child, group],
      assets: [],
      variables: [],
      markers: [],
      createdAt: 1,
      modifiedAt: 1,
    };
    const canvas = { width: 320, height: 180 };
    const bufferContext = {
      setTransform: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const outputContext = {
      getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;
    const renderLayerTree = vi.fn().mockResolvedValue(undefined);
    const applyOrdered = vi.fn(() => true);
    const internal = renderer as unknown as {
      createTempCanvas: () => { canvas: typeof canvas; ctx: OffscreenCanvasRenderingContext2D };
      renderLayerTree: typeof renderLayerTree;
      applyOrderedMotionEffectsToBuffer: typeof applyOrdered;
      renderGroupLayerWithAdvancedMasks(
        ctx: OffscreenCanvasRenderingContext2D,
        composition: MotionComposition,
        layer: MotionGroupLayer,
        compositionTime: number,
        localTime: number,
        transform: MotionTransform,
        effects: readonly MotionEffect[],
        options: Record<string, unknown>,
      ): Promise<void>;
    };
    internal.createTempCanvas = vi.fn(() => ({ canvas, ctx: bufferContext }));
    internal.renderLayerTree = renderLayerTree;
    internal.applyOrderedMotionEffectsToBuffer = applyOrdered;

    await internal.renderGroupLayerWithAdvancedMasks(
      outputContext,
      composition,
      group,
      1,
      1,
      DEFAULT_MOTION_TRANSFORM,
      [effect],
      {},
    );

    expect(renderLayerTree).toHaveBeenCalledWith(
      bufferContext,
      composition,
      child,
      1,
      expect.any(Object),
    );
    expect(applyOrdered).toHaveBeenCalledWith(
      expect.objectContaining({ canvas, ctx: bufferContext }),
      group,
      [effect],
      1,
      composition,
      false,
    );
    expect(outputContext.drawImage).toHaveBeenCalledWith(canvas, 0, 0);
  });
});
