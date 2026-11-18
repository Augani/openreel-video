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

  it("keeps the owner's loss callbacks across a recreation and coalesces concurrent recreations", async () => {
    vi.stubGlobal("OffscreenCanvas", TestOffscreenCanvas);
    const renderer = new WebGPURenderer({ canvas: {} as HTMLCanvasElement, width: 64, height: 64 });
    const internal = renderer as unknown as { initialize: () => Promise<boolean> };
    let release!: (ok: boolean) => void;
    internal.initialize = vi.fn(() => new Promise<boolean>((resolve) => (release = resolve)));
    const callback = vi.fn();
    renderer.onDeviceLost(callback);

    // the owner's handler and the renderer's own retry loop both ask: one initialize, shared result
    const first = renderer.recreateDevice();
    const second = renderer.recreateDevice();
    expect(second).toBe(first);
    release(true);
    await expect(first).resolves.toBe(true);
    expect(internal.initialize).toHaveBeenCalledTimes(1);

    // a second loss must still reach the owner
    const callbacks = (renderer as unknown as { deviceLostCallbacks: Array<() => void> }).deviceLostCallbacks;
    expect(callbacks).toEqual([callback]);

    // a failed recreation leaves the renderer lost (not alive) and can be retried
    const failed = renderer.recreateDevice();
    release(false);
    await expect(failed).resolves.toBe(false);
    expect(renderer.isLost()).toBe(true);
    const retry = renderer.recreateDevice();
    release(true);
    await expect(retry).resolves.toBe(true);
    expect(internal.initialize).toHaveBeenCalledTimes(3);
  });
});
