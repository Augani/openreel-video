import { afterEach, describe, expect, it, vi } from "vitest";
import { GpuGradeChain, isWebGpuGradeSupported, resetSharedGpuGrade } from "./gpu-grade-chain";
import { planGpuGradeChain } from "./gpu-grade-plan";
import { DEFAULT_TONE } from "./color-grading-engine";

const plan = planGpuGradeChain([], { tone: { ...DEFAULT_TONE, exposure: 0.3 } }, 64, 36)!;
const fakeBitmap = { width: 64, height: 36, close: vi.fn() } as unknown as ImageBitmap;

afterEach(() => {
  vi.unstubAllGlobals();
  resetSharedGpuGrade();
});

describe("GpuGradeChain without WebGPU", () => {
  it("reports unsupported and hands the frame back to the caller's path", async () => {
    vi.stubGlobal("navigator", {});
    expect(isWebGpuGradeSupported()).toBe(false);
    const chain = new GpuGradeChain();
    expect(await chain.run(fakeBitmap, plan)).toBeNull();
    expect(chain.broken).toBe(true);
    expect(chain.stats.fallbacks).toBe(1);
    expect(chain.stats.frames).toBe(0);
    expect(chain.stats.readbacks).toBe(0);
  });

  it("falls back when the adapter is unavailable", async () => {
    vi.stubGlobal("OffscreenCanvas", class {});
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => null } });
    const chain = new GpuGradeChain();
    expect(await chain.run(fakeBitmap, plan)).toBeNull();
    expect(chain.broken).toBe(true);
  });

  it("falls back when the device cannot be created", async () => {
    vi.stubGlobal("OffscreenCanvas", class {});
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => ({ requestDevice: async () => Promise.reject(new Error("no device")) }) } });
    const chain = new GpuGradeChain();
    expect(await chain.run(fakeBitmap, plan)).toBeNull();
    expect(chain.broken).toBe(true);
  });

  it("keeps software WebGPU adapters on the reference renderer", async () => {
    vi.stubGlobal("OffscreenCanvas", class {});
    const requestDevice = vi.fn();
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => ({ info: { isFallbackAdapter: true }, requestDevice }) } });
    const chain = new GpuGradeChain();
    expect(await chain.run(fakeBitmap, plan)).toBeNull();
    expect(chain.broken).toBe(true);
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it("an empty plan is not run at all", async () => {
    const chain = new GpuGradeChain();
    expect(await chain.run(fakeBitmap, { passes: [] })).toBeNull();
    expect(chain.broken).toBe(false);
  });
});

async function makeEngine(): Promise<InstanceType<typeof import("./video-engine").VideoEngine>> {
  vi.stubGlobal("self", { onmessage: null, postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const { VideoEngine } = await import("./video-engine");
  return new VideoEngine();
}

describe("VideoEngine grade chain switch", () => {
  it("is off where WebGPU is missing and cannot be switched on", async () => {
    vi.stubGlobal("navigator", {});
    const engine = await makeEngine();
    expect(engine.isGpuGradeEnabled()).toBe(false);
    engine.setGpuGradeEnabled(true);
    expect(engine.isGpuGradeEnabled()).toBe(false);
    expect(engine.getGpuGradeStats()).toBeNull();
  });

  it("can be switched off on a WebGPU machine, which keeps clips on the Canvas2D grade", async () => {
    vi.stubGlobal("OffscreenCanvas", class {});
    vi.stubGlobal("navigator", { gpu: {} });
    const engine = await makeEngine();
    expect(engine.isGpuGradeEnabled()).toBe(true);
    engine.setGpuGradeEnabled(false);
    expect(engine.isGpuGradeEnabled()).toBe(false);
  });
});
