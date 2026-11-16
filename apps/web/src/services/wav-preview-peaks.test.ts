import { describe, expect, it } from "vitest";
import { wavPreviewPeaks } from "./wav-preview-peaks";
function wav(samples: number[]) {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, s, true));
  return buffer;
}
describe("WAV preview envelope", () => {
  it("uses peak magnitudes from each actual PCM segment", () => {
    expect(wavPreviewPeaks(wav([0, 16384, -32768, 8192]), 2)).toEqual([0.5, 1]);
  });
  it("does not invent a waveform for unsupported or truncated data", () => {
    expect(wavPreviewPeaks(new ArrayBuffer(3))).toEqual([]);
    const invalid = wav([0]);
    new DataView(invalid).setUint32(40, 1000, true);
    expect(wavPreviewPeaks(invalid)).toEqual([]);
  });
});
