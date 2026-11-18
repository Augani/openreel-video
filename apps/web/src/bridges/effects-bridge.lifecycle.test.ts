import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as realEngines from "../services/engine-modules";
import { setEngineModulesForTests } from "../services/lazy-engines";
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

const fakeEngines = () => ({
  ...realEngines,
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
}) as unknown as typeof realEngines;

function deferredInitialization() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((complete) => { resolve = complete; });
  engines.initialize.mockReturnValueOnce(promise);
  return () => resolve(true);
}

describe("EffectsBridge initialization lifetime", () => {
  beforeEach(() => {
    setEngineModulesForTests(fakeEngines());
    disposeEffectsBridge();
    engines.instances.length = 0;
    engines.initialize.mockReset().mockResolvedValue(true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    setEngineModulesForTests(realEngines);
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

  it("retains authored filter and template metadata through a live bridge roundtrip", async () => {
    const bridge = await initializeEffectsBridge();
    const metadata = { filterPreset: { presetId: "cinematic-noir", applicationId: "filter", index: 0 },
      templateSource: { templateId: "template", applicationId: "application", ownerClipId: "clip" } };
    const effect = { id: "effect", type: "grain", enabled: true, params: { amount: 18 }, order: 0, metadata };
    expect(bridge.deserializeEffects("clip", { effects: [effect], colorGrading: {} }).success).toBe(true);
    expect(bridge.getEffects("clip")[0].metadata).toEqual(metadata);
    expect(bridge.serializeEffects("clip").effects).toEqual([effect]);
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
