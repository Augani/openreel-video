import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disposeEffectsBridge,
  EffectsBridge,
  getEffectsBridge,
  initializeEffectsBridge,
} from "./effects-bridge";

const engines = vi.hoisted(() => ({
  initialize: vi.fn(() => Promise.resolve(true)),
  instances: [] as { dispose: ReturnType<typeof vi.fn> }[],
}));

vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return {
    ...actual,
    isWebGPUSupported: () => false,
    VideoEffectsEngine: class {
      initialize = () => engines.initialize();
      dispose = vi.fn();
      constructor() { engines.instances.push(this); }
    },
    ColorGradingEngine: class {
      initialize = vi.fn();
      dispose = vi.fn();
    },
  };
});

function deferredInitialization() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((complete) => { resolve = complete; });
  engines.initialize.mockReturnValueOnce(promise);
  return () => resolve(true);
}

describe("EffectsBridge initialization lifetime", () => {
  beforeEach(() => {
    disposeEffectsBridge();
    engines.instances.length = 0;
    engines.initialize.mockReset().mockResolvedValue(true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    disposeEffectsBridge();
    vi.restoreAllMocks();
  });

  it("creates a live bridge when the editor remounts after disposal", async () => {
    const first = await initializeEffectsBridge(1920, 1080);
    disposeEffectsBridge();
    const second = await initializeEffectsBridge(1080, 1920);

    expect(second).not.toBe(first);
    expect(first.isInitialized()).toBe(false);
    expect(second.isInitialized()).toBe(true);
    expect(engines.instances).toHaveLength(2);
    expect(engines.instances[0].dispose).toHaveBeenCalledOnce();
  });

  it("shares pending setup across synchronous preview getters and async startup", async () => {
    const complete = deferredInitialization();
    const bridge = getEffectsBridge();
    const startup = initializeEffectsBridge();
    expect(getEffectsBridge()).toBe(bridge);
    expect(getEffectsBridge()).toBe(bridge);
    expect(engines.instances).toHaveLength(1);

    complete();
    expect(await startup).toBe(bridge);
    expect(bridge.isInitialized()).toBe(true);
    expect(engines.initialize).toHaveBeenCalledOnce();
  });

  it("releases late GPU resources and keeps a replacement editor's bridge alive", async () => {
    const complete = deferredInitialization();
    const oldBridge = getEffectsBridge();
    const oldStartup = initializeEffectsBridge();
    const cancelled = expect(oldStartup).rejects.toThrow("disposed during initialization");
    disposeEffectsBridge();

    const replacement = await initializeEffectsBridge(1080, 1920);
    complete();
    await cancelled;

    expect(oldBridge.isInitialized()).toBe(false);
    expect(replacement.isInitialized()).toBe(true);
    expect(getEffectsBridge()).toBe(replacement);
    // Dispose both the initial resources and anything created after awaiting GPU setup.
    expect(engines.instances[0].dispose).toHaveBeenCalledTimes(2);
    expect(engines.instances[1].dispose).not.toHaveBeenCalled();
  });

  it("allows retry after initialization fails", async () => {
    engines.initialize.mockRejectedValueOnce(new Error("GPU setup failed"));
    await expect(initializeEffectsBridge()).rejects.toThrow("GPU setup failed");
    const recovered = await initializeEffectsBridge();

    expect(recovered.isInitialized()).toBe(true);
    expect(engines.instances).toHaveLength(2);
    expect(engines.instances[0].dispose).toHaveBeenCalledOnce();
  });

  it("does not let old work overwrite a new initialization on the same bridge", async () => {
    const complete = deferredInitialization();
    const bridge = new EffectsBridge();
    const oldStartup = bridge.initialize();
    const cancelled = expect(oldStartup).rejects.toThrow("disposed during initialization");
    bridge.dispose();
    await bridge.initialize(1080, 1920);
    complete();
    await cancelled;

    expect(bridge.isInitialized()).toBe(true);
    expect(engines.instances[1].dispose).not.toHaveBeenCalled();
    bridge.dispose();
    expect(engines.instances[1].dispose).toHaveBeenCalledOnce();
  });
});
