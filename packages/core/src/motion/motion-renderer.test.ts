import { describe, expect, it, vi } from "vitest";
import { MotionRenderer } from "./motion-renderer";
import type { MotionComposition, MotionScene3DLayer } from "./types";
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

});
