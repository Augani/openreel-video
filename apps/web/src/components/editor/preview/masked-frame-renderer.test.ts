import { describe, expect, it, vi } from "vitest";
import type { Mask } from "@openreel/core";
import { DEFAULT_TRANSFORM } from "./types";
import { drawFrameWithMasks } from "./masked-frame-renderer";

function bitmap(name: string) {
  return {
    name,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

function mask(id: string): Mask {
  return {
    id,
    clipId: "clip-1",
    type: "drawn",
    path: {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    },
    feathering: 0,
    inverted: false,
    expansion: 0,
    opacity: 1,
    keyframes: [],
  };
}

describe("drawFrameWithMasks", () => {
  it("uses the direct renderer when the clip has no masks", async () => {
    const drawFrame = vi.fn();
    const loadMasks = vi.fn();
    const applyMask = vi.fn();
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;

    await drawFrameWithMasks(
      {
        ctx,
        frame: bitmap("source"),
        transform: DEFAULT_TRANSFORM,
        canvasWidth: 640,
        canvasHeight: 360,
        masks: [],
        maskEngine: { loadMasks, applyMask },
        time: 1.5,
      },
      { drawFrame },
    );

    expect(drawFrame).toHaveBeenCalledOnce();
    expect(loadMasks).not.toHaveBeenCalled();
    expect(applyMask).not.toHaveBeenCalled();
  });

  it("renders an isolated layer and applies every mask in sequence", async () => {
    const drawFrame = vi.fn();
    const drawImage = vi.fn();
    const layerCtx = { drawImage: vi.fn() };
    const initial = bitmap("initial");
    const first = bitmap("first");
    const second = bitmap("second");
    const masks = [mask("mask-a"), mask("mask-b")];
    const loadMasks = vi.fn();
    const applyMask = vi
      .fn()
      .mockResolvedValueOnce({ image: first, processingTime: 1, gpuAccelerated: false })
      .mockResolvedValueOnce({ image: second, processingTime: 1, gpuAccelerated: false });

    await drawFrameWithMasks(
      {
        ctx: { drawImage } as unknown as CanvasRenderingContext2D,
        frame: bitmap("source"),
        transform: DEFAULT_TRANSFORM,
        canvasWidth: 640,
        canvasHeight: 360,
        masks,
        maskEngine: { loadMasks, applyMask },
        time: 2.25,
      },
      {
        createCanvas: () =>
          ({ getContext: () => layerCtx }) as unknown as OffscreenCanvas,
        createBitmap: vi.fn().mockResolvedValue(initial),
        drawFrame,
      },
    );

    expect(drawFrame).toHaveBeenCalledOnce();
    expect(loadMasks).toHaveBeenCalledWith(masks);
    expect(applyMask).toHaveBeenNthCalledWith(1, initial, masks[0], 2.25);
    expect(applyMask).toHaveBeenNthCalledWith(2, first, masks[1], 2.25);
    expect(drawImage).toHaveBeenCalledWith(second, 0, 0, 640, 360);
    expect(initial.close).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });
});
