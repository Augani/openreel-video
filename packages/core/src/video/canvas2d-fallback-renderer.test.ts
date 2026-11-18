import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Effect } from "../types/timeline";

const engine = vi.hoisted(() => ({
  applyEffectsToCanvas: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./video-effects-engine", () => ({
  VideoEffectsEngine: class {
    applyEffectsToCanvas = engine.applyEffectsToCanvas;
    dispose = engine.dispose;
  },
}));

interface Draw {
  image: unknown;
  filter: string;
  composite: string;
}
const draws: Draw[] = [];

class FakeCtx {
  filter = "none";
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
  clearRect() {}
  drawImage(image: unknown) {
    draws.push({ image, filter: this.filter, composite: this.globalCompositeOperation });
  }
}
class FakeBitmap {
  constructor(
    public width = 64,
    public height = 36,
  ) {}
}
class FakeOffscreen {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return new FakeCtx();
  }
}

const effect = (type: string, params: Record<string, unknown> = {}): Effect =>
  ({ id: type, type, enabled: true, params }) as Effect;

async function render(effects: Effect[]) {
  const { Canvas2DFallbackRenderer } = await import("./canvas2d-fallback-renderer");
  const renderer = new Canvas2DFallbackRenderer({
    canvas: new FakeOffscreen(64, 36) as unknown as OffscreenCanvas,
    width: 64,
    height: 36,
  });
  await renderer.initialize();
  const bitmap = new FakeBitmap() as unknown as ImageBitmap;
  renderer.beginFrame();
  renderer.renderLayer({
    texture: renderer.applyEffects(bitmap, effects),
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
  vi.stubGlobal("createImageBitmap", async () => new FakeBitmap());
  await renderer.endFrame();
  return { bitmap, renderer };
}

beforeEach(() => {
  draws.length = 0;
  engine.applyEffectsToCanvas.mockReset();
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Canvas2DFallbackRenderer effects", () => {
  it.each(["glow", "vignette", "sharpen", "grain", "shadow"])(
    "routes %s through the shared pixel path and draws its output",
    async (type) => {
      const processed = { marker: type };
      engine.applyEffectsToCanvas.mockResolvedValue(processed);
      const { bitmap } = await render([effect(type, { amount: 50 })]);
      expect(engine.applyEffectsToCanvas).toHaveBeenCalledWith(bitmap, [
        expect.objectContaining({ type }),
      ]);
      expect(draws).toHaveLength(1);
      expect(draws[0].image).toBe(processed);
    },
  );

  it("draws the untouched image when there are no effects", async () => {
    const { bitmap } = await render([]);
    expect(engine.applyEffectsToCanvas).not.toHaveBeenCalled();
    expect(draws[0].image).toBe(bitmap);
  });

  it("keeps blend as a composite operation, not a pixel effect", async () => {
    engine.applyEffectsToCanvas.mockResolvedValue(null);
    await render([effect("blend", { mode: "multiply" })]);
    expect(engine.applyEffectsToCanvas).not.toHaveBeenCalled();
    expect(draws[0].composite).toBe("multiply");
  });

  it("falls back to CSS filters if the shared path throws", async () => {
    engine.applyEffectsToCanvas.mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { bitmap } = await render([effect("brightness", { value: 20 })]);
    expect(draws[0].image).toBe(bitmap);
    expect(draws[0].filter).toBe("brightness(1.2)");
    warn.mockRestore();
  });
});
