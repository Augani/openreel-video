import { describe, expect, it } from "vitest";
import { audioBufferToWhisperSamples } from "./whisper-audio";

function fakeAudioBuffer(channels: number[][], sampleRate: number): AudioBuffer {
  return {
    sampleRate,
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (index: number) => new Float32Array(channels[index]),
  } as AudioBuffer;
}

describe("audioBufferToWhisperSamples", () => {
  it("mixes channels to mono", () => {
    const samples = audioBufferToWhisperSamples(
      fakeAudioBuffer(
        [new Array(16_000).fill(1), new Array(16_000).fill(-0.5)],
        16_000,
      ),
    );
    expect(samples).toHaveLength(16_000);
    expect(samples[100]).toBeCloseTo(0.25);
  });

  it("resamples and crops the source range", () => {
    const samples = audioBufferToWhisperSamples(
      fakeAudioBuffer([new Array(48_000).fill(0.5)], 48_000),
      0.25,
      0.75,
    );
    expect(samples).toHaveLength(8_000);
    expect(samples[4_000]).toBeCloseTo(0.5);
  });
});
