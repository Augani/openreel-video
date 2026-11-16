import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ initialized: false, getEffects: vi.fn(), getColorGrading: vi.fn(), processEffectList: vi.fn() }));
vi.mock("../../../bridges/effects-bridge", () => ({ getEffectsBridge: () => ({ ...mocks, isInitialized: () => mocks.initialized }) }));
vi.mock("@openreel/core", async () => ({ ...await vi.importActual<typeof import("@openreel/core")>("@openreel/core"), getBackgroundRemovalEngine: () => null }));
import { applyEffectsToFrame, disposePreview3DRenderer } from "./canvas-renderers";
import { clipNeedsFrameProcessing } from "./frame-processing";

const clip = { id: "iris-cold", mediaId: "image", startTime: 10, effects: [], keyframes: [
  { id: "start", property: "effect.iris-circle", time: 0, value: 0, easing: "linear" as const },
  { id: "end", property: "effect.iris-circle", time: 1, value: 1, easing: "linear" as const },
] };
const maskContext = { save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), beginPath: vi.fn(), rect: vi.fn(),
  moveTo: vi.fn(), arc: vi.fn(), clip: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn() };
let allocations: number;
class MaskCanvas { constructor(public width: number, public height: number) { allocations++; } getContext() { return maskContext; } }
const source = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
const output = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
const originalOffscreenCanvas = globalThis.OffscreenCanvas;

beforeEach(() => {
  disposePreview3DRenderer(); vi.clearAllMocks(); allocations = 0; mocks.initialized = false;
  mocks.getEffects.mockReturnValue([]); mocks.getColorGrading.mockReturnValue({}); mocks.processEffectList.mockResolvedValue(output);
  globalThis.OffscreenCanvas = MaskCanvas as unknown as typeof OffscreenCanvas;
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(output));
});
afterEach(() => { disposePreview3DRenderer(); globalThis.OffscreenCanvas = originalOffscreenCanvas; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("iris preview before effects initialization", () => {
  it("uses a reusable vector surface while cold, without touching caller-owned frames", async () => {
    expect(clipNeedsFrameProcessing(clip.id, clip, 0.25)).toBe(true);
    for (let index = 0; index < 2; index++) expect(await applyEffectsToFrame(clip.id, source, { clip, time: 10.25 })).toBe(output);
    expect(allocations).toBe(1);
    expect(maskContext.clip).toHaveBeenCalledWith("evenodd");
    expect(maskContext.arc).toHaveBeenCalledWith(320, 180, Math.hypot(320, 180) * 0.25, 0, Math.PI * 2);
    expect(source.close).not.toHaveBeenCalled(); expect(output.close).not.toHaveBeenCalled();
    expect(mocks.processEffectList).not.toHaveBeenCalled();
  });
});
