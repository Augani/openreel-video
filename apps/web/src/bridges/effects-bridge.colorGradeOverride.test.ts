import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@openreel/core", async () => {
  const actual =
    await vi.importActual<typeof import("@openreel/core")>("@openreel/core");
  return {
    ...actual,
    isWebGPUSupported: () => false,
    VideoEffectsEngine: class {
      async initialize(): Promise<void> {}
      async applyEffects(image: unknown) {
        return { image, processingTime: 0 };
      }
      getRendererType(): string {
        return "canvas2d";
      }
      isUsingWebGPU(): boolean {
        return false;
      }
    },
    ColorGradingEngine: class {
      initialize(): void {}
      dispose(): void {}
    },
  };
});

import { EffectsBridge } from "./effects-bridge";

const CLIP_ID = "clip-color-grade";

describe("EffectsBridge color grading override", () => {
  let bridge: EffectsBridge;

  beforeEach(async () => {
    bridge = new EffectsBridge();
    await bridge.initialize(64, 64);
  });

  it("returns override values when no base exists", () => {
    bridge.setColorGradingOverride(CLIP_ID, { temperature: 40 });

    expect(bridge.getColorGrading(CLIP_ID).temperature).toBe(40);
  });

  it("lets the override win over the stored base value", () => {
    bridge.applyWhiteBalance(CLIP_ID, { temperature: 10, tint: -20 });
    bridge.setColorGradingOverride(CLIP_ID, { temperature: 40 });

    const result = bridge.getColorGrading(CLIP_ID);
    expect(result.temperature).toBe(40);
    expect(result.tint).toBe(-20);
  });

  it("reverts to the base value after clearing the override", () => {
    bridge.applyWhiteBalance(CLIP_ID, { temperature: 10 });
    bridge.setColorGradingOverride(CLIP_ID, { temperature: 40 });

    expect(bridge.getColorGrading(CLIP_ID).temperature).toBe(40);

    bridge.clearColorGradingOverride(CLIP_ID);

    expect(bridge.getColorGrading(CLIP_ID).temperature).toBe(10);
  });
});
