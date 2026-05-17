import { describe, expect, it } from "vitest";
import { AudioEffectsEngine } from "./audio-effects-engine";

const createAudioBuffer = (samples: Float32Array): AudioBuffer =>
  ({
    length: samples.length,
    duration: samples.length / 48000,
    sampleRate: 48000,
    numberOfChannels: 1,
    getChannelData: () => samples,
  }) as unknown as AudioBuffer;

describe("AudioEffectsEngine noise profiles", () => {
  it("learns variance data needed for spectral noise reduction", async () => {
    const samples = new Float32Array(4096);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin(index * 0.13) * 0.08 + Math.sin(index * 0.41) * 0.03;
    }

    const engine = new AudioEffectsEngine({} as AudioContext);
    await engine.initialize({} as AudioContext);

    const profile = await engine.learnNoiseProfile(createAudioBuffer(samples), "noise");

    expect(profile.frequencyBins.length).toBe(profile.magnitudes.length);
    expect(profile.standardDeviations?.length).toBe(profile.magnitudes.length);
    expect(profile.fftSize).toBe(2048);
  });
});