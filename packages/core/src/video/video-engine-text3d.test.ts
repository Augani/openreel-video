import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_TRANSFORM, type TextClip } from "../text/types";

const clip: TextClip = {
  id: "extruded-title", trackId: "titles", startTime: 1, duration: 5, text: "New Title",
  style: DEFAULT_TEXT_STYLE, transform: { ...DEFAULT_TEXT_TRANSFORM, rotate3d: { x: -10, y: 18, z: 0 } },
  keyframes: [], effects: [],
  text3d: { enabled: true, depth: 12, bevelThickness: 1.5, bevelSize: 0.8, bevelSegments: 3, material: "physical" },
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("self", { onmessage: null, postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  vi.doUnmock("./overlay-three-renderer");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function setup(loadGate?: Promise<void>) {
  const canvas = { width: 1280, height: 720 } as OffscreenCanvas;
  const mesh = {};
  const renderTextClip = vi.fn(() => mesh);
  const prepareTextClip = vi.fn(async () => {});
  const resize = vi.fn(), dispose = vi.fn(), construct = vi.fn(), drawImage = vi.fn();
  const moduleLoad = vi.fn(async () => {
    await loadGate;
    return {
    ThreeJSLayerRenderer: class {
      constructor() { construct(); }
      canvas = canvas;
      prepareTextClip = prepareTextClip;
      renderTextClip = renderTextClip;
      resize = resize;
      dispose = dispose;
      clear = vi.fn();
      getScene() { return { add: vi.fn() }; }
      render() { return canvas; }
    },
    };
  });
  vi.doMock("./overlay-three-renderer", moduleLoad);
  const { titleEngine } = await import("../text/title-engine");
  const renderText = vi.spyOn(titleEngine, "renderText").mockReturnValue({
    canvas, width: 1280, height: 720, textMetrics: { width: 0, height: 0, lines: [] },
  });
  const { VideoEngine } = await import("./video-engine");
  const engine = new VideoEngine();
  const ctx = { drawImage } as unknown as OffscreenCanvasRenderingContext2D;
  const draw = (target = clip) => (engine as unknown as {
    renderTextClipToCanvasCtx(ctx: OffscreenCanvasRenderingContext2D, clip: TextClip, time: number,
      width: number, height: number, projectWidth: number, projectHeight: number): Promise<void>;
  }).renderTextClipToCanvasCtx(ctx, target, 2, 1280, 720, 1920, 1080);
  return { engine, draw, titleEngine, canvas, renderTextClip, prepareTextClip, resize, dispose, construct, drawImage, moduleLoad, renderText };
}

describe("VideoEngine 3D title export", () => {
  it("samples blur after 3D rendering while preserving the existing rotation", async () => {
    const s = await setup();
    const drawEffects = vi.fn().mockResolvedValue(undefined);
    (s.engine as unknown as { drawOverlayCanvasWithEffects: typeof drawEffects }).drawOverlayCanvasWithEffects = drawEffects;
    await s.draw({ ...clip, keyframes: [
      { id: "blur-start", property: "blur", time: 0, value: 20, easing: "linear" },
      { id: "blur-end", property: "blur", time: 4, value: 0, easing: "linear" },
    ] });
    expect(s.renderTextClip).toHaveBeenCalledWith(expect.objectContaining({ transform: expect.objectContaining({ rotate3d: clip.transform.rotate3d }) }), 1920, 1080);
    expect(drawEffects).toHaveBeenCalledWith(expect.anything(), s.canvas, [expect.objectContaining({ type: "blur", params: { radius: 15 } })], 1280, 720);
  });

  it("renders 3D text through the shared renderer in project coordinates", async () => {
    const s = await setup();
    await s.draw();
    expect(s.prepareTextClip).toHaveBeenCalledOnce();
    expect(s.resize).toHaveBeenCalledWith(1280, 720, 1920, 1080);
    expect(s.renderTextClip).toHaveBeenCalledWith(expect.objectContaining({
      text: clip.text, text3d: clip.text3d, transform: clip.transform,
    }), 1920, 1080);
    expect(s.renderText).not.toHaveBeenCalled();
    expect(s.drawImage).toHaveBeenCalledWith(s.canvas, 0, 0);
  });

  it("waits for font readiness before publishing the first encoded frame", async () => {
    const s = await setup();
    const font = deferred();
    s.prepareTextClip.mockImplementationOnce(() => font.promise);
    const frame = s.draw();
    await vi.waitFor(() => expect(s.prepareTextClip).toHaveBeenCalledOnce());
    expect(s.renderTextClip).not.toHaveBeenCalled();
    expect(s.drawImage).not.toHaveBeenCalled();
    font.resolve();
    await frame;
    expect(s.renderTextClip).toHaveBeenCalledOnce();
    expect(s.drawImage).toHaveBeenCalledOnce();
  });

  it("keeps ordinary 2D shader exports on TitleEngine without importing Three", async () => {
    const s = await setup();
    const shader: TextClip = {
      ...clip, text3d: undefined, transform: DEFAULT_TEXT_TRANSFORM,
      style: { ...clip.style, shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ffffff" } } },
    };
    await s.draw(shader);
    expect(s.moduleLoad).not.toHaveBeenCalled();
    expect(s.renderText).toHaveBeenCalledWith(shader, 1280, 720, 1, { x: 2 / 3, y: 2 / 3 });
  });

  it("does not encode a flat fallback when its 3D font fails", async () => {
    const s = await setup();
    s.prepareTextClip.mockRejectedValueOnce(new Error("3D font unavailable"));
    await expect(s.draw()).rejects.toThrow("3D font unavailable");
    expect(s.renderText).not.toHaveBeenCalled();
    expect(s.drawImage).not.toHaveBeenCalled();
  });

  it("releases a renderer disposed while its font loads and does not publish a late frame", async () => {
    const s = await setup();
    const font = deferred();
    s.prepareTextClip.mockImplementationOnce(() => font.promise);
    const frame = s.draw();
    await vi.waitFor(() => expect(s.prepareTextClip).toHaveBeenCalledOnce());
    s.engine.dispose();
    font.resolve();
    await frame;
    expect(s.dispose).toHaveBeenCalledOnce();
    expect(s.renderTextClip).not.toHaveBeenCalled();
    expect(s.drawImage).not.toHaveBeenCalled();
  });

  it("does not allocate a GPU renderer after disposal during the module import", async () => {
    const gate = deferred();
    const s = await setup(gate.promise);
    const frame = s.draw();
    await vi.waitFor(() => expect(s.moduleLoad).toHaveBeenCalledOnce());
    s.engine.dispose();
    gate.resolve();
    await frame;
    expect(s.construct).not.toHaveBeenCalled();
    expect(s.drawImage).not.toHaveBeenCalled();
  });

  it("samples clip-local opacity keyframes before building its 3D geometry", async () => {
    const s = await setup();
    await s.draw({ ...clip, keyframes: [
      { id: "start", property: "opacity", time: 0, value: 0, easing: "linear" },
      { id: "end", property: "opacity", time: 2, value: 1, easing: "linear" },
    ] });
    expect(s.renderTextClip).toHaveBeenCalledWith(expect.objectContaining({
      transform: expect.objectContaining({ opacity: 0.5 }),
    }), 1920, 1080);
  });
});
