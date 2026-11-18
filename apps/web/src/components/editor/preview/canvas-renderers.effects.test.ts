import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
const source = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
const output = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
const mocks = vi.hoisted(() => ({
  getEffects: vi.fn(), getColorGrading: vi.fn(), processEffects: vi.fn(),
  processEffectList: vi.fn(), processColorGrading: vi.fn(), processEffectsToCanvas: vi.fn(),
}));
vi.mock("../../../bridges/effects-bridge", () => ({ getEffectsBridge: () => ({ ...mocks, isInitialized: () => true }) }));
vi.mock("@openreel/core", async () => ({
  ...await vi.importActual<typeof import("@openreel/core")>("@openreel/core"),
  getBackgroundRemovalEngine: () => null,
}));
import { applyEffectsToFrame } from "./canvas-renderers";

const clip: Pick<Clip, "id" | "effects" | "keyframes" | "startTime"> = {
  id: "offset", startTime: 10, effects: [], keyframes: [
    { id: "t0", time: 0, property: "effect.temperature", value: -6, easing: "linear" },
    { id: "t4", time: 4, property: "effect.temperature", value: 14, easing: "linear" },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEffects.mockReturnValue([]);
  mocks.getColorGrading.mockReturnValue({});
  mocks.processEffectList.mockResolvedValue(output);
  mocks.processEffects.mockResolvedValue({ image: output, processingTime: 0 });
});

describe("preview animated effect frames", () => {
  it("samples local effect keyframes even when the clip has no static effects", async () => {
    expect(await applyEffectsToFrame(clip.id, source, { clip, time: 12 })).toBe(output);
    expect(mocks.processEffectList).toHaveBeenCalledWith(source, [expect.objectContaining({
      type: "temperature", params: { value: 4 },
    })]);
    expect(mocks.processEffects).not.toHaveBeenCalled();
    expect(clip.effects).toEqual([]);
    expect(source.close).not.toHaveBeenCalled();
  });

  it("preserves the static bridge path for a clip without effect animation", async () => {
    mocks.getEffects.mockReturnValue([{ id: "brightness", type: "brightness", enabled: true, params: { value: 0.2 } }]);
    expect(await applyEffectsToFrame(clip.id, source, { clip: { ...clip, keyframes: [] }, time: 12 })).toBe(output);
    expect(mocks.processEffects).toHaveBeenCalledWith(clip.id, source);
    expect(mocks.processEffectList).not.toHaveBeenCalled();
  });

  it("keeps color grading after the sampled effect stack", async () => {
    const graded = { ...output, close: vi.fn() };
    mocks.getColorGrading.mockReturnValue({ temperature: 5 });
    mocks.processColorGrading.mockResolvedValue({ image: graded });
    expect(await applyEffectsToFrame(clip.id, source, { clip, time: 12 })).toBe(graded);
    expect(mocks.processColorGrading).toHaveBeenCalledWith(clip.id, output);
    expect(output.close).toHaveBeenCalledTimes(1);
    expect(source.close).not.toHaveBeenCalled();
    expect(graded.close).not.toHaveBeenCalled();
  });

});
