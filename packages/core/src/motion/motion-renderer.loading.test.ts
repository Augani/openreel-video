import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MOTION_TRANSFORM, type MotionComposition, type MotionScene3DLayer } from "./types";
import type { MotionRendererAssetResolver, MotionScene3DRenderResult } from "./motion-renderer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const composition: MotionComposition = {
  id: "loading", name: "Loading", width: 640, height: 360, frameRate: 30,
  duration: 4, backgroundColor: "#101820", layers: [], assets: [], variables: [], markers: [], createdAt: 1, modifiedAt: 1,
};
const layer: MotionScene3DLayer = {
  id: "box", type: "scene3d", name: "Box", startTime: 0, duration: 4,
  visible: true, locked: false, transform: DEFAULT_MOTION_TRANSFORM, keyframes: [],
  object: { kind: "box" },
};

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.doUnmock("./motion-three-renderer"); });

async function setup(loadGate?: Promise<void>) {
  const image = {} as OffscreenCanvas;
  const drawImage = vi.fn();
  const construct = vi.fn();
  const dispose = vi.fn();
  const render = vi.fn().mockResolvedValue(image);
  const moduleLoad = vi.fn(async () => {
    await loadGate;
    return {
      MotionThreeRenderer: class {
        constructor() { construct(); }
        isAvailable() { return true; }
        render = render;
        dispose = dispose;
      },
    };
  });
  vi.doMock("./motion-three-renderer", moduleLoad);
  const { MotionRenderer } = await import("./motion-renderer");
  const renderer = new MotionRenderer();
  const ctx = { drawImage } as unknown as OffscreenCanvasRenderingContext2D;
  const draw = (resolver?: MotionRendererAssetResolver, target = layer) => (
    renderer as unknown as {
      renderScene3D(ctx: OffscreenCanvasRenderingContext2D, composition: MotionComposition, layer: MotionScene3DLayer,
        options: { assetResolver?: MotionRendererAssetResolver }, time: number): Promise<void>;
    }
  ).renderScene3D(ctx, composition, target, { assetResolver: resolver }, 1.25);
  return { renderer, draw, moduleLoad, construct, dispose, render, drawImage, image };
}

describe("on-demand Motion 3D rendering", () => {
  it("keeps importing MotionRenderer and native rendering free of the fallback module", async () => {
    const s = await setup();
    expect(s.moduleLoad).not.toHaveBeenCalled();
    const release = vi.fn();
    await s.draw({
      resolveImageAsset: () => null,
      renderScene3D: () => ({ image: s.image, release }),
    });
    expect(s.moduleLoad).not.toHaveBeenCalled();
    expect(s.drawImage).toHaveBeenCalledWith(s.image, -320, -180, 640, 360);
    expect(release).toHaveBeenCalledOnce();
  });

  it("loads once for concurrent fallback requests and preserves render inputs", async () => {
    const gate = deferred<void>();
    const s = await setup(gate.promise);
    const draws = [s.draw(), s.draw()];
    await vi.waitFor(() => expect(s.moduleLoad).toHaveBeenCalledOnce());
    expect(s.construct).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all(draws);
    expect(s.construct).toHaveBeenCalledOnce();
    expect(s.render).toHaveBeenCalledTimes(2);
    expect(s.render).toHaveBeenCalledWith(expect.objectContaining({
      layer, timeSeconds: 1.25, width: 640, height: 360,
    }));
    expect(s.drawImage).toHaveBeenCalledTimes(2);
    s.renderer.dispose();
    expect(s.dispose).toHaveBeenCalledOnce();
  });

  it("does not allocate a late fallback after disposal and permits a fresh render", async () => {
    const gate = deferred<void>();
    const s = await setup(gate.promise);
    const draw = s.draw();
    await vi.waitFor(() => expect(s.moduleLoad).toHaveBeenCalledOnce());
    s.renderer.dispose();
    gate.resolve();
    await draw;
    expect(s.construct).not.toHaveBeenCalled();
    expect(s.drawImage).not.toHaveBeenCalled();
    await s.draw();
    expect(s.construct).toHaveBeenCalledOnce();
    expect(s.drawImage).toHaveBeenCalledOnce();
  });

  it("releases a late native frame after disposal without publishing it or loading fallback", async () => {
    const s = await setup();
    const frame = deferred<MotionScene3DRenderResult>();
    const release = vi.fn();
    const draw = s.draw({ resolveImageAsset: () => null, renderScene3D: () => frame.promise });
    s.renderer.dispose();
    frame.resolve({ image: s.image, release });
    await draw;
    expect(release).toHaveBeenCalledOnce();
    expect(s.drawImage).not.toHaveBeenCalled();
    expect(s.moduleLoad).not.toHaveBeenCalled();
  });

  it("does not render after model resolution finishes for a disposed renderer", async () => {
    const s = await setup();
    const model = deferred<string>();
    const resolveModelUrl = vi.fn(() => model.promise);
    const draw = s.draw({ resolveImageAsset: () => null, resolveModelUrl }, {
      ...layer, object: { kind: "model", modelUrl: "asset:model" },
    });
    await vi.waitFor(() => expect(resolveModelUrl).toHaveBeenCalledOnce());
    s.renderer.dispose();
    model.resolve("blob:model");
    await draw;
    expect(s.dispose).toHaveBeenCalledOnce();
    expect(s.render).not.toHaveBeenCalled();
    expect(s.drawImage).not.toHaveBeenCalled();
  });
});
