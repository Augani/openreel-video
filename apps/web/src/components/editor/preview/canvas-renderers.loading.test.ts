import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextClip, ShapeClip } from "@openreel/core";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const text: TextClip = {
  id: "title", trackId: "titles", startTime: 0, duration: 4, text: "Paper title",
  style: {
    fontFamily: "Inter", fontSize: 72, fontWeight: 700, fontStyle: "normal",
    color: "#ffffff", textAlign: "center", verticalAlign: "middle", lineHeight: 1.2, letterSpacing: 0,
  },
  transform: {
    position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0,
    anchor: { x: 0.5, y: 0.5 }, opacity: 1,
  },
  keyframes: [],
};

let fixture: Awaited<ReturnType<typeof setup>>;
let gate: ReturnType<typeof deferred>;
beforeEach(async () => {
  vi.resetModules();
  gate = deferred();
  // Importing the full core/bridge graph is fixture preparation. Keep its cold
  // transform cost separate from the lifecycle assertions' five-second timeout.
  fixture = await setup(gate.promise);
}, 20_000);
afterEach(() => {
  vi.doUnmock("./threejs-layer-renderer");
  vi.restoreAllMocks();
});

async function setup(gate?: Promise<void>) {
  const construct = vi.fn();
  const dispose = vi.fn();
  const mesh = {};
  const renderTextClip = vi.fn(() => mesh);
  const renderShapeClip = vi.fn(() => mesh);
  const add = vi.fn();
  const canvas = document.createElement("canvas");
  const resize = vi.fn((width: number, height: number) => {
    canvas.width = width; canvas.height = height;
  });
  const moduleLoad = vi.fn(async () => {
    await gate;
    return {
      ThreeJSLayerRenderer: class {
        constructor(width: number, height: number) { construct(); resize(width, height); }
        canvas = canvas;
        dispose = dispose;
        setFontReadyCallback = vi.fn();
        clear = vi.fn();
        resize = resize;
        renderTextClip = renderTextClip;
        renderShapeClip = renderShapeClip;
        getScene() { return { add }; }
        render() { return canvas; }
      },
    };
  });
  vi.doMock("./threejs-layer-renderer", moduleLoad);
  const api = await import("./canvas-renderers");
  const drawImage = vi.fn();
  const ctx = { drawImage } as unknown as CanvasRenderingContext2D;
  return { api, moduleLoad, construct, dispose, renderTextClip, renderShapeClip, canvas, drawImage, ctx, resize };
}

describe("deferred preview 3D renderer", () => {
  it("renders ordinary Paper shader text synchronously without loading Three.js", async () => {
    const s = fixture;
    const { titleEngine } = await import("@openreel/core");
    const rendered = {
      canvas: document.createElement("canvas"), width: 640, height: 360,
      textMetrics: { width: 200, height: 72, lines: [] },
    };
    const renderText = vi.spyOn(titleEngine, "renderText").mockReturnValue(rendered);
    const shaderTitle: TextClip = {
      ...text, style: { ...text.style, shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ffffff" } } },
    };
    expect(s.api.renderTextClipToCanvas(s.ctx, shaderTitle, 640, 360, 1.25)).toBeUndefined();
    expect(renderText).toHaveBeenCalledWith(shaderTitle, 640, 360, 1.25);
    expect(s.drawImage).toHaveBeenCalledWith(rendered.canvas, 0, 0, 640, 360);
    expect(s.moduleLoad).not.toHaveBeenCalled();
  });

  it("awaits the first 3D title frame, shares one renderer and retains mesh-shape routing", async () => {
    const s = fixture;
    const title3d: TextClip = {
      ...text, transform: { ...text.transform, rotate3d: { x: 25, y: 10, z: 0 } },
    };
    const shape: ShapeClip = {
      id: "mesh", trackId: "shapes", type: "shape", shapeType: "mesh-cube",
      startTime: 0, duration: 4, transform: text.transform,
      style: {
        fill: { type: "solid", color: "#ffffff", opacity: 1 },
        stroke: { color: "#000000", width: 0, opacity: 1 },
      }, keyframes: [],
    };
    const frames = [
      s.api.renderTextClipToCanvas(s.ctx, title3d, 640, 360, 1),
      s.api.renderShapeClipToCanvas(s.ctx, shape, 640, 360, 1),
    ];
    await vi.waitFor(() => expect(s.moduleLoad).toHaveBeenCalledOnce());
    expect(s.drawImage).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all(frames);
    expect(s.construct).toHaveBeenCalledOnce();
    expect(s.renderTextClip).toHaveBeenCalledOnce();
    expect(s.renderShapeClip).toHaveBeenCalledOnce();
    expect(s.drawImage).toHaveBeenCalledTimes(2);
    await s.api.renderTextClipToCanvas(s.ctx, title3d, 1280, 720, 2);
    expect(s.construct).toHaveBeenCalledOnce();
    expect(s.resize).toHaveBeenLastCalledWith(1280, 720);
    s.api.disposePreview3DRenderer();
    expect(s.dispose).toHaveBeenCalledOnce();
  });

  it("does not allocate a late GPU renderer after preview cleanup and can render when reopened", async () => {
    const s = fixture;
    const title3d: TextClip = { ...text, blendMode: "multiply" };
    const frame = s.api.renderTextClipToCanvas(s.ctx, title3d, 640, 360, 1);
    await vi.waitFor(() => expect(s.moduleLoad).toHaveBeenCalledOnce());
    s.api.disposePreview3DRenderer();
    gate.resolve();
    await frame;
    expect(s.construct).not.toHaveBeenCalled();
    expect(s.drawImage).not.toHaveBeenCalled();
    await s.api.renderTextClipToCanvas(s.ctx, title3d, 640, 360, 1);
    expect(s.construct).toHaveBeenCalledOnce();
    expect(s.drawImage).toHaveBeenCalledOnce();
  });
});
