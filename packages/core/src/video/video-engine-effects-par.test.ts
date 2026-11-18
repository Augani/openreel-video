import { afterEach, describe, expect, it, vi } from "vitest";
import { graphicsEngine } from "../graphics/graphics-engine";
import type { ShapeClip } from "../graphics/types";
import { displayLayoutWidth, snapshotInDisplaySpace } from "./sequence-par";

class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return { drawImage: vi.fn() };
  }
}

const PARS = [
  { name: "DV NTSC", par: 10 / 11 },
  { name: "HDV", par: 4 / 3 },
  { name: "anamorphic", par: 2 },
];

describe("snapshotInDisplaySpace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resamples a stored canvas to the display width for a non-square PAR", async () => {
    const calls: unknown[][] = [];
    vi.stubGlobal("createImageBitmap", async (...a: unknown[]) => {
      calls.push(a);
      return { width: 0, height: 0 };
    });
    const source = {} as ImageBitmapSource;
    await snapshotInDisplaySpace(source, 720, 480, 2);
    expect(calls[0]).toEqual([source, 0, 0, 720, 480, { resizeWidth: 1440, resizeHeight: 480, resizeQuality: "high" }]);
  });

  it("is a plain snapshot for square pixels", async () => {
    const calls: unknown[][] = [];
    vi.stubGlobal("createImageBitmap", async (...a: unknown[]) => {
      calls.push(a);
      return {};
    });
    const source = {} as ImageBitmapSource;
    await snapshotInDisplaySpace(source, 720, 480, 1);
    expect(calls[0]).toEqual([source, 0, 0, 720, 480]);
  });
});

describe("VideoEngine runs effects in display space at a non-square PAR", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function makeEngine(par: number) {
    vi.stubGlobal("self", { onmessage: null, postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    const seen: Array<{ width: number; height: number }> = [];
    vi.stubGlobal("createImageBitmap", async (source: { width: number; height: number }, ...rest: unknown[]) => {
      const opts = rest[4] as { resizeWidth?: number; resizeHeight?: number } | undefined;
      return { width: opts?.resizeWidth ?? source.width, height: opts?.resizeHeight ?? source.height, close: () => undefined };
    });
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine() as unknown as {
      sequencePixelAspect: number;
      ensureEffectsEngine: () => Promise<unknown>;
      renderShapeClipToCanvasCtx(ctx: unknown, clip: ShapeClip, time: number, w: number, h: number): Promise<void>;
      applyAdjustmentLayerToCtx(ctx: unknown, layer: unknown, w: number, h: number): Promise<void>;
    };
    engine.sequencePixelAspect = par;
    engine.ensureEffectsEngine = async () => ({
      applyEffects: async (image: { width: number; height: number }) => {
        seen.push({ width: image.width, height: image.height });
        return { image: { width: image.width, height: image.height, close: () => undefined } };
      },
    });
    return { engine, seen };
  }

  const blur = { id: "b", type: "blur", enabled: true, params: { radius: 12 } };

  for (const { name, par } of PARS) {
    it(`blurs an overlay in display space, then squeezes the result (${name} ${par})`, async () => {
      const { engine, seen } = await makeEngine(par);
      vi.spyOn(graphicsEngine, "renderGraphic").mockImplementation(async (_c, _t, w, h) => ({
        canvas: new FakeCanvas(w, h) as unknown as OffscreenCanvas,
        width: w,
        height: h,
      }));
      const target = { drawImage: vi.fn() };
      const clip = { id: "s", trackId: "t", startTime: 0, duration: 5, type: "shape", shapeType: "circle", effects: [blur] } as unknown as ShapeClip;
      await engine.renderShapeClipToCanvasCtx(target, clip, 0, 720, 480);
      // The blur saw the display-width canvas, not the stored one: its radius is measured in display pixels.
      expect(seen).toEqual([{ width: displayLayoutWidth(720, par), height: 480 }]);
      // And what reaches the frame is squeezed into stored pixels in one drawImage.
      expect(target.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 720, 480]);
    });

    it(`runs adjustment-layer effects on a display-space snapshot of the frame (${name} ${par})`, async () => {
      const { engine, seen } = await makeEngine(par);
      const ctx = {
        canvas: new FakeCanvas(720, 480),
        save: vi.fn(),
        restore: vi.fn(),
        drawImage: vi.fn(),
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
      };
      await engine.applyAdjustmentLayerToCtx(ctx, { id: "a", effects: [blur], opacity: 1, blendMode: "normal" }, 720, 480);
      expect(seen).toEqual([{ width: displayLayoutWidth(720, par), height: 480 }]);
      expect(ctx.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 720, 480]);
    });
  }

  it("leaves square pixels untouched", async () => {
    const { engine, seen } = await makeEngine(1);
    const ctx = { canvas: new FakeCanvas(720, 480), save: vi.fn(), restore: vi.fn(), drawImage: vi.fn() };
    await engine.applyAdjustmentLayerToCtx(ctx, { id: "a", effects: [blur], opacity: 1, blendMode: "normal" }, 720, 480);
    expect(seen).toEqual([{ width: 720, height: 480 }]);
  });
});
