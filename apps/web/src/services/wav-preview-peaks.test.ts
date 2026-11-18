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

import { wavPreviewEnvelope } from "./wav-preview-peaks";

function envelopeWav(samples: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true); view.setUint32(28, 88200, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.round(v * 32767), true));
  return buffer;
}

describe("wavPreviewEnvelope", () => {
  it("separates a loud section from a quiet one even when both contain a full-scale hit", () => {
    const loud = Array.from({ length: 400 }, (_, i) => (i % 2 ? 0.9 : -0.9));
    const quiet = Array.from({ length: 400 }, (_, i) => (i === 0 ? 1 : i % 2 ? 0.1 : -0.1));
    const data = envelopeWav([...loud, ...quiet]);
    expect(wavPreviewPeaks(data, 8)[4]).toBeGreaterThan(0.99);
    const envelope = wavPreviewEnvelope(data, 8);
    expect(envelope[0]).toBeGreaterThan(0.95);
    expect(envelope[7]).toBeLessThan(0.2);
  });
  it("stays flat for a constant tone instead of inventing dynamics", () => {
    const tone = Array.from({ length: 800 }, (_, i) => (i % 2 ? 0.5 : -0.5));
    expect(wavPreviewEnvelope(envelopeWav(tone), 8).every((v) => v > 0.99)).toBe(true);
  });
});
