import { describe, expect, it } from "vitest";
import { DEFAULT_NOISE_REDUCTION } from "../../../bridges/audio-bridge-effects";
import {
  suggestNoiseReductionConfig,
  suggestNoiseReductionPreset,
} from "./noise-reduction-presets";

const createProfile = (
  frequencyBins: number[],
  magnitudes: number[],
) => ({
  id: "profile-test",
  frequencyBins: new Float32Array(frequencyBins),
  magnitudes: new Float32Array(magnitudes),
  sampleRate: 48000,
  createdAt: Date.now(),
});

describe("noise reduction presets", () => {
  it("recommends white-noise cleanup for broadband hiss", () => {
    const preset = suggestNoiseReductionPreset(
      createProfile(
        [80, 250, 1000, 4000, 8000, 12000],
        [0.78, 0.82, 0.8, 0.79, 0.81, 0.8],
      ),
    );

    expect(preset).toBe("whiteNoise");
  });

  it("recommends music-bed cleanup for tonal midrange background music", () => {
    const config = suggestNoiseReductionConfig(
      createProfile(
        [80, 220, 440, 880, 1760, 3520, 8000],
        [0.08, 1.8, 1.1, 0.85, 0.68, 0.42, 0.12],
      ),
    );

    expect(config.focus).toBe("music");
    expect(config.reduction).toBeGreaterThan(0.8);
  });

  it("pushes broadband white-noise recommendations into aggressive settings", () => {
    const config = suggestNoiseReductionConfig(
      createProfile(
        [80, 250, 1000, 4000, 8000, 12000],
        [0.78, 0.82, 0.8, 0.79, 0.81, 0.8],
      ),
    );

    expect(config.focus).toBe("whiteNoise");
    expect(config.reduction).toBeGreaterThanOrEqual(0.9);
    expect(config.threshold).toBeLessThanOrEqual(-50);
  });

  it("detects low-end tonal noise as hum or HVAC", () => {
    const preset = suggestNoiseReductionPreset(
      createProfile(
        [60, 120, 250, 1000, 4000, 8000],
        [1.3, 1.1, 0.35, 0.12, 0.08, 0.05],
      ),
    );

    expect(preset).toBe("hum");
  });

  it("uses wind cleanup when low-frequency rumble dominates", () => {
    const config = suggestNoiseReductionConfig(
      createProfile(
        [40, 80, 160, 500, 1500, 4000, 8000],
        [1.1, 1, 0.82, 0.25, 0.18, 0.12, 0.08],
      ),
    );

    expect(config.focus).toBe("wind");
    expect(config.reduction).toBeGreaterThan(0.7);
  });

  it("falls back to the default denoise settings when the profile is unusable", () => {
    const suggested = suggestNoiseReductionConfig(
      createProfile(
        [80, 250, 1000],
        [Number.NaN, Number.POSITIVE_INFINITY, 0],
      ),
    );

    expect(suggested).toEqual(DEFAULT_NOISE_REDUCTION);
  });
});