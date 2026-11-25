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
    const applyMasks = vi.fn();
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;

    await drawFrameWithMasks(
      {
        ctx,
        frame: bitmap("source"),
        transform: DEFAULT_TRANSFORM,
        canvasWidth: 640,
        canvasHeight: 360,
        masks: [],
        maskEngine: { loadMasks, applyMasks },
        time: 1.5,
      },
      { drawFrame },
    );

    expect(drawFrame).toHaveBeenCalledOnce();
    expect(loadMasks).not.toHaveBeenCalled();
    expect(applyMasks).not.toHaveBeenCalled();
  });

  it("renders an isolated layer and applies all masks once via applyMasks (honouring combine modes)", async () => {
    const drawFrame = vi.fn();
    const drawImage = vi.fn();
    const layerCtx = { drawImage: vi.fn() };
    const initial = bitmap("initial");
    const second = bitmap("second");
    const masks = [
      mask("mask-a"),
      { ...mask("mask-b"), combine: "subtract" as const },
    ];
    const loadMasks = vi.fn();
    const applyMasks = vi
      .fn()
      .mockResolvedValue({ image: second, processingTime: 1, gpuAccelerated: false });

    await drawFrameWithMasks(
      {
        ctx: { drawImage } as unknown as CanvasRenderingContext2D,
        frame: bitmap("source"),
        transform: DEFAULT_TRANSFORM,
        canvasWidth: 640,
        canvasHeight: 360,
        masks,
        maskEngine: { loadMasks, applyMasks },
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
    expect(applyMasks).toHaveBeenCalledOnce();
    expect(applyMasks).toHaveBeenCalledWith(initial, masks, 2.25);
    expect(drawImage).toHaveBeenCalledWith(second, 0, 0, 640, 360);
    expect(initial.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it("effect masks cross-fade the processed and raw pictures and never cut the clip", async () => {
    const drawFrame = vi.fn();
    const drawImage = vi.fn();
    const layerCtx = { drawImage: vi.fn() };
    const initial = bitmap("processed");
    const mixed = bitmap("mixed");
    const base = bitmap("raw");
    const effectMask = { ...mask("fx"), appliesTo: "effects" as const };
    const loadMasks = vi.fn();
    const applyMasks = vi.fn();
    const composeEffectMasks = vi.fn().mockResolvedValue(mixed);

    await drawFrameWithMasks(
      {
        ctx: { drawImage } as unknown as CanvasRenderingContext2D,
        frame: bitmap("source"),
        baseFrame: base,
        transform: DEFAULT_TRANSFORM,
        canvasWidth: 640,
        canvasHeight: 360,
        masks: [effectMask],
        maskEngine: { loadMasks, applyMasks, composeEffectMasks },
        time: 1,
        filter: "blur(2px)",
      },
      {
        createCanvas: () => ({ getContext: () => layerCtx }) as unknown as OffscreenCanvas,
        createBitmap: vi.fn().mockResolvedValue(initial),
        drawFrame,
      },
    );

    // Processed layer (with the filter) and raw layer (without it) are drawn separately.
    expect(drawFrame).toHaveBeenCalledTimes(2);
    expect(drawFrame.mock.calls[0][5]).toBe("blur(2px)");
    expect(drawFrame.mock.calls[1][1]).toBe(base);
    expect(drawFrame.mock.calls[1][5]).toBeUndefined();
    expect(composeEffectMasks).toHaveBeenCalledWith(initial, expect.anything(), [effectMask], 1);
    expect(applyMasks).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(mixed, 0, 0, 640, 360);
    expect(initial.close).toHaveBeenCalledOnce();
    expect(mixed.close).toHaveBeenCalledOnce();
  });

  it("an effect mask without a base picture shows the processed clip everywhere", async () => {
    const drawFrame = vi.fn();
    const applyMasks = vi.fn();
    await drawFrameWithMasks(
      {
        ctx: { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D,
        frame: bitmap("source"),
        transform: DEFAULT_TRANSFORM,
        canvasWidth: 640,
        canvasHeight: 360,
        masks: [{ ...mask("fx"), appliesTo: "effects" as const }],
        maskEngine: { loadMasks: vi.fn(), applyMasks },
        time: 0,
      },
      { drawFrame },
    );
    expect(drawFrame).toHaveBeenCalledOnce();
    expect(applyMasks).not.toHaveBeenCalled();
  });

  it("effect masks and visibility masks combine: scope first, then cut", async () => {
    const mixed = bitmap("mixed");
    const cut = bitmap("cut");
    const loadMasks = vi.fn();
    const applyMasks = vi.fn().mockResolvedValue({ image: cut, processingTime: 1, gpuAccelerated: false });
    const composeEffectMasks = vi.fn().mockResolvedValue(mixed);
    const effectMask = { ...mask("fx"), appliesTo: "effects" as const };
    const cutMask = mask("cut");
    const drawImage = vi.fn();
    await drawFrameWithMasks(
      {
        ctx: { drawImage } as unknown as CanvasRenderingContext2D,
        frame: bitmap("source"),
        baseFrame: bitmap("raw"),
        transform: DEFAULT_TRANSFORM,
        canvasWidth: 640,
        canvasHeight: 360,
        masks: [effectMask, cutMask],
        maskEngine: { loadMasks, applyMasks, composeEffectMasks },
        time: 3,
      },
      {
        createCanvas: () => ({ getContext: () => ({ drawImage: vi.fn() }) }) as unknown as OffscreenCanvas,
        createBitmap: vi.fn().mockResolvedValue(bitmap("processed")),
        drawFrame: vi.fn(),
      },
    );
    expect(composeEffectMasks).toHaveBeenCalledWith(expect.anything(), expect.anything(), [effectMask], 3);
    expect(applyMasks).toHaveBeenCalledWith(mixed, [cutMask], 3);
    expect(drawImage).toHaveBeenCalledWith(cut, 0, 0, 640, 360);
  });
});
