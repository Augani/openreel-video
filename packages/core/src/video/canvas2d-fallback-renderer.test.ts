import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Canvas2DFallbackRenderer } from "./canvas2d-fallback-renderer";

describe("Canvas2DFallbackRenderer", () => {
  const drawImage = vi.fn();
  const context = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    filter: "none",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  };

  class MockImageBitmap {
    width = 320;
    height = 180;
  }

  class MockOffscreenCanvas {
    constructor(public width: number, public height: number) {}
    getContext() {
      return context;
    }
  }

  beforeEach(() => {
    vi.stubGlobal("ImageBitmap", MockImageBitmap);
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => new MockImageBitmap()));
    drawImage.mockClear();
    context.filter = "none";
    context.globalCompositeOperation = "source-over";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves supported effects and blend modes on the Canvas2D path", async () => {
    const renderer = new Canvas2DFallbackRenderer({
      canvas: {} as HTMLCanvasElement,
      width: 640,
      height: 360,
    });
    await renderer.initialize();
    const bitmap = new MockImageBitmap() as unknown as ImageBitmap;
    const texture = renderer.applyEffects(bitmap, [
      { id: "brightness", type: "brightness", enabled: true, params: { value: 20 } },
      { id: "blur", type: "blur", enabled: true, params: { radius: 4 } },
      { id: "sepia", type: "sepia", enabled: true, params: { amount: 0.75 } },
      { id: "blend", type: "blend", enabled: true, params: { mode: "screen" } },
    ]);

    renderer.beginFrame();
    renderer.renderLayer({
      texture,
      transform: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
        anchor: { x: 0.5, y: 0.5 },
      },
      effects: [],
      opacity: 1,
      borderRadius: 0,
    });
    await renderer.endFrame();

    expect(context.filter).toBe("brightness(1.2) blur(4px) sepia(0.75)");
    expect(context.globalCompositeOperation).toBe("screen");
    expect(drawImage).toHaveBeenCalledWith(bitmap, -160, -90);
  });
});
