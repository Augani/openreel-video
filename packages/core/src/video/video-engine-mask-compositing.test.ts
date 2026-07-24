import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transform } from "../types/timeline";
import type { Mask } from "./mask-engine";

function bitmap(name: string) {
  return { name, close: vi.fn(), width: 640, height: 360 } as unknown as ImageBitmap;
}

const transform: Transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

const mask: Mask = {
  id: "export-mask",
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
  opacity: 0.75,
  keyframes: [],
};

describe("VideoEngine mask compositing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isolates the transformed clip and applies masks before export compositing", async () => {
    vi.stubGlobal("self", {
      onmessage: null,
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const { VideoEngine } = await import("./video-engine");
    const layerCtx = {} as OffscreenCanvasRenderingContext2D;
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          return layerCtx;
        }
      },
    );
    const initial = bitmap("initial");
    const masked = bitmap("masked");
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(initial));

    const drawFrameToContext = vi.fn();
    const loadMasks = vi.fn();
    const applyMask = vi.fn().mockResolvedValue({
      image: masked,
      processingTime: 1,
      gpuAccelerated: false,
    });
    const engine = new VideoEngine();
    const surface = engine as unknown as {
      drawFrameToContext: typeof drawFrameToContext;
      drawClipFrameToContext: (
        ctx: OffscreenCanvasRenderingContext2D,
        frame: ImageBitmap,
        transform: Transform,
        opacity: number,
        width: number,
        height: number,
        masks: readonly Mask[],
        time: number,
      ) => Promise<void>;
      maskEngine: { loadMasks: typeof loadMasks; applyMask: typeof applyMask };
    };
    surface.drawFrameToContext = drawFrameToContext;
    surface.maskEngine = { loadMasks, applyMask };
    const drawImage = vi.fn();

    await surface.drawClipFrameToContext(
      { drawImage } as unknown as OffscreenCanvasRenderingContext2D,
      bitmap("source"),
      transform,
      1,
      640,
      360,
      [mask],
      1.25,
    );

    expect(drawFrameToContext).toHaveBeenCalledWith(
      layerCtx,
      expect.anything(),
      transform,
      1,
      640,
      360,
    );
    expect(loadMasks).toHaveBeenCalledWith([mask]);
    expect(applyMask).toHaveBeenCalledWith(initial, mask, 1.25);
    expect(drawImage).toHaveBeenCalledWith(masked, 0, 0, 640, 360);
    expect(initial.close).toHaveBeenCalledOnce();
    expect(masked.close).toHaveBeenCalledOnce();
  });
});
