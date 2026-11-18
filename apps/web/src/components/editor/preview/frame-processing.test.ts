import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Effect } from "@openreel/core";
const mocks = vi.hoisted(() => ({
  getEffects: vi.fn(), getColorGrading: vi.fn(), processEffectList: vi.fn(),
  processEffects: vi.fn(), processEffectsToCanvas: vi.fn(), processColorGrading: vi.fn(),
}));
vi.mock("../../../bridges/effects-bridge", () => ({ getEffectsBridge: () => ({ ...mocks, isInitialized: () => true }) }));
vi.mock("@openreel/core", async () => ({
  ...await vi.importActual<typeof import("@openreel/core")>("@openreel/core"),
  getBackgroundRemovalEngine: () => null,
}));
import { renderOverlayLayerWithEffects } from "./frame-processing";

const clip = { id: "overlay", startTime: 10, effects: [] as Effect[], keyframes: [
  { id: "start", property: "blur", time: 0, value: 20, easing: "linear" as const },
  { id: "end", property: "blur", time: 4, value: 0, easing: "linear" as const },
] };
let source: ImageBitmap;
let output: ImageBitmap;
let layerCanvas: HTMLCanvasElement;
const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
const layerCtx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
beforeEach(() => {
  vi.clearAllMocks();
  source = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
  output = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
  mocks.getEffects.mockReturnValue([]);
  mocks.getColorGrading.mockReturnValue({});
  mocks.processEffectList.mockResolvedValue(output);
  mocks.processColorGrading.mockResolvedValue({ image: output });
  layerCanvas = document.createElement("canvas");
  Object.defineProperty(layerCanvas, "getContext", { value: () => layerCtx, configurable: true });
  vi.spyOn(document, "createElement").mockReturnValue(layerCanvas);
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(source));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("animated overlay frame processing", () => {

  it.each(["blur", "effect.blur"])("samples %s at clip-local time and closes only owned frames", async (property) => {
    const render = vi.fn();
    await renderOverlayLayerWithEffects(ctx, clip.id, 640, 360, render, {
      clip: { ...clip, keyframes: clip.keyframes.map(key => ({ ...key, property })) }, time: 11,
    });
    expect(render).toHaveBeenCalledWith(layerCtx);
    expect(mocks.processEffectList).toHaveBeenCalledWith(source, [expect.objectContaining({ type: "blur", enabled: true, params: { radius: 15 } })]);
    expect(mocks.processEffects).not.toHaveBeenCalled();
    expect(mocks.processEffectsToCanvas).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(output, 0, 0, 640, 360);
    expect(source.close).toHaveBeenCalledOnce();
    expect(output.close).toHaveBeenCalledOnce();
  });

  it("waits for the asynchronous shader/3D layer before processing its completed pixels", async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const frame = renderOverlayLayerWithEffects(ctx, clip.id, 640, 360, async () => { await gate; }, { clip, time: 12 });
    expect(createImageBitmap).not.toHaveBeenCalled();
    finish();
    await frame;
    expect(mocks.processEffectList).toHaveBeenCalledWith(source, [expect.objectContaining({ params: { radius: 10 } })]);
  });

  it("preserves disabled blur and unrelated shader metadata while sampling", async () => {
    const effects: Effect[] = [
      { id: "material", type: "shader", enabled: true, params: { shaderId: "paper-halftone-dots" } },
      { id: "bypass", type: "blur", enabled: false, params: { radius: 7, preserve: 4 }, metadata: { label: "Keep" } },
    ];
    mocks.getEffects.mockReturnValue(effects);
    await renderOverlayLayerWithEffects(ctx, clip.id, 640, 360, vi.fn(), { clip: { ...clip, effects }, time: 12 });
    // Bypassed blur stays bypassed; the shader still renders in its original order.
    expect(mocks.processEffectList).toHaveBeenCalledWith(source, [effects[0], { ...effects[1], params: { radius: 10, preserve: 4 } }]);
    expect(effects[1].params.radius).toBe(7);
  });
});
