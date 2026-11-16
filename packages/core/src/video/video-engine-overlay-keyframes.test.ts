import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { titleEngine } from "../text/title-engine";
import { graphicsEngine } from "../graphics/graphics-engine";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_TRANSFORM } from "../text/types";

beforeEach(() => {
  vi.stubGlobal("self", { onmessage: null, postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("export overlay keyframe effects", () => {
  it.each([
    ["text", "renderTextClipToCanvasCtx"], ["shape", "renderShapeClipToCanvasCtx"],
    ["svg", "renderSVGClipToCanvasCtx"], ["sticker", "renderStickerClipToCanvasCtx"],
  ] as const)("forwards the real %s iris to the shared export effect path", async (type, method) => {
    const canvas = {} as OffscreenCanvas;
    vi.spyOn(titleEngine, "renderText").mockReturnValue({ canvas, width: 640, height: 360, textMetrics: { width: 10, height: 10, lines: [] } });
    vi.spyOn(graphicsEngine, "renderGraphic").mockResolvedValue({ canvas, width: 640, height: 360 });
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine() as unknown as Record<string, (...args: unknown[]) => Promise<void>>;
    const draw = vi.fn().mockResolvedValue(undefined); engine.drawOverlayCanvasWithEffects = draw;
    const clip = { id: type, type, text: "Keep material", trackId: "overlays", startTime: 10, duration: 4,
      transform: { ...DEFAULT_TEXT_TRANSFORM, position: { x: 0.25, y: 0.75 } }, style: DEFAULT_TEXT_STYLE,
      effects: [], keyframes: [
        { id: "open", property: "effect.iris-diamond", time: 0, value: 0, easing: "linear" },
        { id: "full", property: "effect.iris-diamond", time: 4, value: 1, easing: "linear" },
      ] };
    const ctx = {}; await engine[method](ctx, clip, 11, 640, 360, 1920, 1080);
    expect(draw).toHaveBeenCalledWith(ctx, canvas, [expect.objectContaining({ type: "mask", params: {
      irisShape: "diamond", progress: 0.25, centerX: 0.25, centerY: 0.75,
    } })], 640, 360);
  });
  it("draws directly after blur reaches zero, without bitmap or effects-engine work", async () => {
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine() as unknown as Record<string, (...args: unknown[]) => Promise<void>>;
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("No frame should be allocated")));
    const source = {};
    const ctx = { drawImage: vi.fn() };
    await engine.drawOverlayCanvasWithEffects(ctx, source, [
      { id: "finished", type: "blur", enabled: true, params: { radius: 0 } },
      { id: "off", type: "brightness", enabled: false, params: { value: 2 } },
    ], 640, 360);
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0);
  });

  it.each(["blur", "effect.iris-star"])("retains 3D, crop and fit settings with a %s text keyframe", (property) => {
    const transform = { ...DEFAULT_TEXT_TRANSFORM, rotate3d: { x: -12, y: 18, z: 3 },
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }, fitMode: "cover" as const, borderRadius: 9 };
    const clip = { id: "title", text: "Keep 3D", trackId: "titles", startTime: 10, duration: 4,
      transform, style: DEFAULT_TEXT_STYLE, keyframes: [{ id: "effect", property, time: 0, value: 0.5, easing: "linear" as const }], effects: [] };
    expect(titleEngine.getAnimatedTextState(clip, 1).transform).toEqual(transform);
    expect(clip.transform.rotate3d.x).toBe(-12);
  });

  it("retains media 3D and base transform fields while sampling an iris reveal", async () => {
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine() as unknown as { getAnimatedTransform: (clip: unknown, time: number) => unknown };
    const transform = { ...DEFAULT_TEXT_TRANSFORM, scale: { x: -0.8, y: 1.2 }, opacity: 0.4,
      rotate3d: { x: -12, y: 18, z: 3 }, perspective: 800,
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }, fitMode: "cover" as const, borderRadius: 9 };
    expect(engine.getAnimatedTransform({ transform, keyframes: [
      { id: "iris", property: "effect.iris-star", time: 0, value: 0.5, easing: "linear" },
    ] }, 0.1)).toEqual(transform);
  });

  it.each([
    ["text", "renderTextClipToCanvasCtx"], ["shape", "renderShapeClipToCanvasCtx"],
    ["svg", "renderSVGClipToCanvasCtx"], ["sticker", "renderStickerClipToCanvasCtx"],
  ] as const)("samples %s blur in the same local time as its transform", async (type, method) => {
    const canvas = {} as OffscreenCanvas;
    vi.spyOn(titleEngine, "renderText").mockReturnValue({ canvas, width: 640, height: 360, textMetrics: { width: 10, height: 10, lines: [] } });
    vi.spyOn(graphicsEngine, "renderGraphic").mockResolvedValue({ canvas, width: 640, height: 360 });
    const { VideoEngine } = await import("./video-engine");
    const draw = vi.fn().mockResolvedValue(undefined);
    const engine = new VideoEngine() as unknown as Record<string, (...args: unknown[]) => Promise<void>>;
    engine.drawOverlayCanvasWithEffects = draw;
    const clip = { id: type, type, text: "Keep material", trackId: "overlay-track", startTime: 10, duration: 4,
      transform: DEFAULT_TEXT_TRANSFORM, style: DEFAULT_TEXT_STYLE,
      keyframes: [
        { id: "a", property: "blur", time: 0, value: 20, easing: "linear" },
        { id: "b", property: "blur", time: 4, value: 0, easing: "linear" },
      ], effects: [] };
    const ctx = {};
    await engine[method](ctx, clip, 11, 640, 360, 1920, 1080);
    expect(draw).toHaveBeenCalledWith(ctx, canvas, [expect.objectContaining({ type: "blur", enabled: true, params: { radius: 15 } })], 640, 360);
    expect(clip.effects).toEqual([]);
    expect(clip.keyframes[0].value).toBe(20);
  });
});
