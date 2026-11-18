import { describe, it, expect } from "vitest";
import { encodeAudioBufferToPcm16 } from "./native-ffmpeg-backend";

function fakeBuffer(channels: number[][]): AudioBuffer {
  return {
    length: channels[0].length,
    numberOfChannels: channels.length,
    getChannelData: (i: number) => Float32Array.from(channels[i]),
  } as unknown as AudioBuffer;
}

describe("encodeAudioBufferToPcm16", () => {
  it("interleaves, clamps and scales", () => {
    const out = new Int16Array(
      encodeAudioBufferToPcm16(fakeBuffer([[0, 1, -1, 2], [0.5, -0.5, -2, 0]]), 2),
    );
    expect(Array.from(out)).toEqual([0, 16384, 32767, -16384, -32768, -32768, 32767, 0]);
  });

  it("duplicates the last source channel when upmixing", () => {
    const out = new Int16Array(encodeAudioBufferToPcm16(fakeBuffer([[1]]), 2));
    expect(Array.from(out)).toEqual([32767, 32767]);
  });
});
