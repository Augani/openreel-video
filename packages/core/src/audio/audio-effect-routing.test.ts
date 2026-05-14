import { describe, expect, it } from "vitest";
import {
  getPanFromAudioEffects,
  getPreviewAudioEffects,
  isSerializedNoiseProfile,
  splitProfileAwareNoiseReductionEffects,
} from "./audio-effect-routing";

describe("audio effect routing helpers", () => {
  it("filters preview-bypassed effects from realtime playback", () => {
    const effects = getPreviewAudioEffects([
      {
        id: "noise",
        type: "noiseReduction",
        enabled: true,
        params: {},
        metadata: { previewBypass: true },
      },
      {
        id: "eq",
        type: "eq",
        enabled: true,
        params: {},
      },
    ]);

    expect(effects.map((effect) => effect.id)).toEqual(["eq"]);
  });

  it("splits profile-aware denoise effects from realtime node effects", () => {
    const effects = splitProfileAwareNoiseReductionEffects([
      {
        id: "profile-noise",
        type: "noiseReduction",
        enabled: true,
        params: {
          reduction: 0.8,
          profile: {
            frequencyBins: [60, 120],
            magnitudes: [1.2, 0.8],
            sampleRate: 48000,
          },
        },
      },
      {
        id: "eq",
        type: "eq",
        enabled: true,
        params: {},
      },
    ]);

    expect(effects.profileAwareNoiseEffects.map((effect) => effect.id)).toEqual([
      "profile-noise",
    ]);
    expect(effects.realtimeEffects.map((effect) => effect.id)).toEqual(["eq"]);
  });

  it("reads pan from audio effects and validates serialized noise profiles", () => {
    expect(
      getPanFromAudioEffects([
        {
          id: "pan",
          type: "pan",
          enabled: true,
          params: { value: 0.35 },
        },
      ]),
    ).toBe(0.35);

    expect(
      isSerializedNoiseProfile({
        frequencyBins: [80, 160, 320],
        magnitudes: [1, 0.8, 0.6],
        sampleRate: 48000,
      }),
    ).toBe(true);
  });
});