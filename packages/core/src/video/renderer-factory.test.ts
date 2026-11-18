import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererFactory, type RendererConfig } from "./renderer-factory";

const backend = vi.hoisted(() => ({
  gpu: vi.fn(),
  cpu: vi.fn(),
  gpuInit: vi.fn(),
  cpuInit: vi.fn(),
  gpuDestroy: vi.fn(),
}));
vi.mock("./webgpu-renderer-impl", () => ({
  WebGPURenderer: class {
    type = "webgpu";
    initialize = backend.gpuInit;
    destroy = backend.gpuDestroy;
    constructor(config: unknown) {
      backend.gpu(config);
    }
  },
}));
vi.mock("./canvas2d-fallback-renderer", () => ({
  Canvas2DFallbackRenderer: class {
    type = "canvas2d";
    initialize = backend.cpuInit;
    destroy = vi.fn();
    constructor(config: unknown) {
      backend.cpu(config);
    }
  },
}));
const config = { canvas: {}, width: 640, height: 360 } as RendererConfig;
beforeEach(() => {
  vi.clearAllMocks();
  backend.gpuInit.mockReset().mockResolvedValue(true);
  backend.cpuInit.mockReset().mockResolvedValue(true);
  vi.stubGlobal("navigator", { gpu: {} });
});
afterEach(() => {
  RendererFactory.getInstance().destroyRenderer();
  vi.unstubAllGlobals();
});
describe("preview renderer preference", () => {
  it("honors the CPU preference even when WebGPU is available", async () => {
    const renderer = await RendererFactory.getInstance().createRenderer({
      ...config,
      preferredRenderer: "canvas2d",
    });
    expect(renderer.type).toBe("canvas2d");
    expect(backend.gpu).not.toHaveBeenCalled();
    expect(backend.cpu).toHaveBeenCalledOnce();
  });
  it("falls back and releases a GPU backend that cannot initialize", async () => {
    backend.gpuInit.mockResolvedValue(false);
    const renderer = await RendererFactory.getInstance().createRenderer({
      ...config,
      preferredRenderer: "webgpu",
    });
    expect(renderer.type).toBe("canvas2d");
    expect(backend.gpuDestroy).toHaveBeenCalledOnce();
  });
  it("keeps the newest backend active when an older GPU request completes later", async () => {
    let finish!: (value: boolean) => void;
    backend.gpuInit.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const factory = RendererFactory.getInstance();
    const previous = factory.createRenderer({
      ...config,
      preferredRenderer: "webgpu",
    });
    await vi.waitFor(() => expect(backend.gpuInit).toHaveBeenCalledOnce());
    const latest = await factory.createRenderer({
      ...config,
      preferredRenderer: "canvas2d",
    });
    finish(true);
    const stale = await previous;
    expect(factory.getCurrentRenderer()).toBe(latest);
    stale.destroy();
  });
});
