import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as realEngines from "../services/engine-modules";
import { setEngineModulesForTests } from "../services/lazy-engines";
import { disposeEffectsBridge, initializeEffectsBridge } from "./effects-bridge";

const fakeEngines = () => ({
  ...realEngines,
  isWebGPUSupported: () => false,
  VideoEffectsEngine: class {
    initialize = () => Promise.resolve(true);
    dispose = vi.fn();
  },
  ColorGradingEngine: class {
    initialize = vi.fn();
    dispose = vi.fn();
  },
}) as unknown as typeof realEngines;

const bitmap = { width: 64, height: 36, close: vi.fn() } as unknown as ImageBitmap;

describe("EffectsBridge WebGPU grade chain", () => {
  beforeEach(async () => {
    setEngineModulesForTests(fakeEngines());
    disposeEffectsBridge();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    setEngineModulesForTests(realEngines);
    disposeEffectsBridge();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hands the frame back (null) where WebGPU is unavailable, so the Canvas2D / WebGL grade runs", async () => {
    vi.stubGlobal("navigator", {});
    const bridge = await initializeEffectsBridge(64, 36);
    expect(await bridge.processClipChainGpu("clip-1", bitmap, null)).toBeNull();
    expect(bridge.getGpuGradeStats()).toBeNull();
  });

  it("stays on the Canvas2D grade when the benchmark / user pinned it", async () => {
    vi.stubGlobal("navigator", { gpu: {} });
    vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "openreel-grade-renderer" ? "canvas2d" : null) });
    const bridge = await initializeEffectsBridge(64, 36);
    expect(await bridge.processClipChainGpu("clip-1", bitmap, null)).toBeNull();
    expect(bridge.getGpuGradeStats()).toBeNull();
  });

  it("returns null while the lazy chain module is still loading, without blocking the frame", async () => {
    vi.stubGlobal("navigator", { gpu: {} });
    const bridge = await initializeEffectsBridge(64, 36);
    expect(await bridge.processClipChainGpu("clip-1", bitmap, null)).toBeNull();
  });
});
