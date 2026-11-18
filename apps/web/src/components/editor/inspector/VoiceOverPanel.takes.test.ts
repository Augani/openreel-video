import { describe, expect, it } from "vitest";
import { listVoiceOverTakes, peakLevel } from "./VoiceOverPanel";

describe("peakLevel", () => {
  it("is 0 for silence and 1 at full scale", () => {
    expect(peakLevel([128, 128, 128])).toBe(0);
    expect(peakLevel([128, 0, 128])).toBe(1);
    expect(peakLevel([128, 192])).toBeCloseTo(0.5);
  });
});

describe("listVoiceOverTakes", () => {
  it("lists clips on Voice Over tracks in time order", () => {
    const takes = listVoiceOverTakes([
      { id: "t1", name: "Main", clips: [{ id: "x", startTime: 0, duration: 5 }] },
      { id: "t2", name: "Voice Over", clips: [{ id: "b", startTime: 9, duration: 3 }, { id: "a", startTime: 2, duration: 4 }] },
    ]);
    expect(takes.map((take) => take.clipId)).toEqual(["a", "b"]);
    expect(takes[0]).toMatchObject({ trackId: "t2", duration: 4 });
  });
});
