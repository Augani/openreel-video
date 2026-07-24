import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGPURenderer } from "./webgpu-renderer-impl";

class TestOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
}

describe("WebGPURenderer lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not report or recover from an intentional device teardown", async () => {
    vi.stubGlobal("OffscreenCanvas", TestOffscreenCanvas);
    let resolveLost: ((info: GPUDeviceLostInfo) => void) | undefined;
    const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
      resolveLost = resolve;
    });
    const device = {
      lost,
      destroy: vi.fn(() =>
        resolveLost?.(
          {
            reason: "destroyed",
            message: "Device was destroyed",
          } as unknown as GPUDeviceLostInfo,
        ),
      ),
    } as unknown as GPUDevice;
    const renderer = new WebGPURenderer({
      canvas: {} as HTMLCanvasElement,
      width: 1920,
      height: 1080,
    });
    const internal = renderer as unknown as {
      device: GPUDevice | null;
      setupDeviceLossHandling: () => void;
      attemptDeviceRecreation: () => Promise<void>;
    };
    internal.device = device;
    internal.attemptDeviceRecreation = vi.fn(async () => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const callback = vi.fn();
    renderer.onDeviceLost(callback);
    internal.setupDeviceLossHandling();

    renderer.destroy();
    await lost;
    await Promise.resolve();

    expect(device.destroy).toHaveBeenCalledOnce();
    expect(warning).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(internal.attemptDeviceRecreation).not.toHaveBeenCalled();
  });
});
