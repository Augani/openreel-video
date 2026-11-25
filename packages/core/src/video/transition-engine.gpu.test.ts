import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transition } from "../types/timeline";

const gpuCanvas = { width: 320, height: 180, tag: "gpu-canvas" };
const gpu = {
  usable: true,
  prepare: vi.fn(async () => true),
  draw: vi.fn(() => true),
  warm: vi.fn(async () => true),
  resize: vi.fn(),
  dispose: vi.fn(),
  canvas: gpuCanvas,
};
const create = vi.fn(async () => gpu);

vi.mock("./transition-gpu-renderer", () => ({
  GpuTransitionRenderer: { create: (...args: unknown[]) => (create as (...a: unknown[]) => unknown)(...args) },
}));

import { TransitionEngine } from "./transition-engine";

const transition = (type: string, params: Record<string, unknown> = {}): Transition =>
  ({ id: "t", clipAId: "a", clipBId: "b", type, duration: 1, params }) as Transition;

const drawImage = vi.fn();
const getImageData = vi.fn();
const context = {
  clearRect: vi.fn(),
  drawImage,
  getImageData,
  save: vi.fn(),
  restore: vi.fn(),
  fillRect: vi.fn(),
  globalAlpha: 1,
};
class MockOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return context;
  }
}
const source = { width: 320, height: 180 } as CanvasImageSource;

describe("TransitionEngine WebGPU routing", () => {
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
    vi.stubGlobal("navigator", { gpu: {} });
    gpu.usable = true;
    gpu.draw.mockReturnValue(true);
    gpu.prepare.mockResolvedValue(true);
    for (const fn of [drawImage, getImageData, create, gpu.draw, gpu.prepare, gpu.warm, gpu.resize, gpu.dispose]) fn.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws a transition on the GPU: the shots go to the GPU, nothing is drawn or read back on a 2D canvas", async () => {
    const engine = new TransitionEngine({ width: 320, height: 180 });
    const result = await engine.renderTransitionToCanvas(source, source, transition("wipe", { direction: "left" }), 0.5);
    expect(result).toBe(gpuCanvas);
    expect(engine.lastRenderPath).toBe("gpu");
    expect(gpu.draw).toHaveBeenCalledTimes(1);
    expect(drawImage).not.toHaveBeenCalled();
    expect(getImageData).not.toHaveBeenCalled();
    // The shader is handed the eased progress the Canvas2D renderers blend with.
    const eased = engine.easedProgress(transition("wipe", { curve: "ease-in" }), 0.5);
    await engine.renderTransitionToCanvas(source, source, transition("wipe", { curve: "ease-in" }), 0.5);
    expect(gpu.draw).toHaveBeenLastCalledWith(expect.anything(), source, source, eased);
  });

  it("creates the renderer once and keeps it across frames", async () => {
    const engine = new TransitionEngine({ width: 320, height: 180 });
    for (const p of [0.1, 0.2, 0.3]) await engine.renderTransitionToCanvas(source, source, transition("crossfade"), p);
    expect(create).toHaveBeenCalledTimes(1);
    expect(gpu.draw).toHaveBeenCalledTimes(3);
  });

  it("falls back to Canvas2D when WebGPU is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const engine = new TransitionEngine({ width: 320, height: 180 });
    expect(await engine.ensureGpu()).toBe(false);
    const result = await engine.renderTransitionToCanvas(source, source, transition("crossfade"), 0.5);
    expect(result).not.toBe(gpuCanvas);
    expect(engine.lastRenderPath).toBe("canvas2d");
    expect(create).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalled();
  });

  it("falls back when the GPU cannot create a device, when it was switched off, or when a frame cannot be drawn", async () => {
    create.mockResolvedValueOnce(null as never);
    const noDevice = new TransitionEngine({ width: 320, height: 180 });
    await noDevice.renderTransitionToCanvas(source, source, transition("crossfade"), 0.5);
    expect(noDevice.lastRenderPath).toBe("canvas2d");

    const off = new TransitionEngine({ width: 320, height: 180, useGPU: false });
    await off.renderTransitionToCanvas(source, source, transition("crossfade"), 0.5);
    expect(off.lastRenderPath).toBe("canvas2d");
    expect(create).toHaveBeenCalledTimes(1);

    const refused = new TransitionEngine({ width: 320, height: 180 });
    gpu.draw.mockReturnValueOnce(false);
    await refused.renderTransitionToCanvas(source, source, transition("crossfade"), 0.5);
    expect(refused.lastRenderPath).toBe("canvas2d");
    await refused.renderTransitionToCanvas(source, source, transition("crossfade"), 0.5);
    expect(refused.lastRenderPath).toBe("gpu");
  });

  it("falls back after a device loss and when a pipeline will not compile", async () => {
    const engine = new TransitionEngine({ width: 320, height: 180 });
    await engine.renderTransitionToCanvas(source, source, transition("crossfade"), 0.5);
    expect(engine.lastRenderPath).toBe("gpu");
    gpu.usable = false;
    expect(engine.isGpuActive()).toBe(false);
    await engine.renderTransitionToCanvas(source, source, transition("crossfade"), 0.5);
    expect(engine.lastRenderPath).toBe("canvas2d");
    gpu.usable = true;
    gpu.prepare.mockResolvedValueOnce(false);
    await engine.renderTransitionToCanvas(source, source, transition("blur"), 0.5);
    expect(engine.lastRenderPath).toBe("canvas2d");
  });

  it("keeps Morph Cut on Canvas2D", async () => {
    const engine = new TransitionEngine({ width: 320, height: 180 });
    await engine.renderTransitionToCanvas(source, source, transition("morphCut"), 0.5);
    expect(engine.lastRenderPath).toBe("canvas2d");
    expect(gpu.draw).not.toHaveBeenCalled();
  });

  it("warm-up compiles on the GPU (round 25 look-ahead) and only draws stand-ins with Canvas2D when it cannot", async () => {
    const engine = new TransitionEngine({ width: 320, height: 180 });
    expect(await engine.warmUp(transition("glitch"))).toBe(true);
    expect(gpu.warm).toHaveBeenCalledTimes(1);
    expect(drawImage).not.toHaveBeenCalled();
    expect(await engine.warmUp(transition("morphCut"))).toBe(false);
    gpu.warm.mockResolvedValueOnce(false);
    expect(await engine.warmUp(transition("glitch"))).toBe(true);
    expect(drawImage).toHaveBeenCalled();
  });

  it("follows a resize and releases the GPU renderer on dispose", async () => {
    const engine = new TransitionEngine({ width: 320, height: 180 });
    await engine.ensureGpu();
    engine.resize(640, 360);
    expect(gpu.resize).toHaveBeenLastCalledWith(640, 360);
    engine.dispose();
    expect(gpu.dispose).toHaveBeenCalled();
  });

  it("releases a renderer that finished creating after dispose()", async () => {
    const engine = new TransitionEngine({ width: 320, height: 180 });
    const pending = engine.ensureGpu();
    engine.dispose();
    expect(await pending).toBe(false);
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(engine.isGpuActive()).toBe(false);
  });
});
