import { describe, expect, it } from "vitest";
import { BeatSyncEngine, DEFAULT_BEAT_SYNC_CONFIG } from "./audio-text-sync-engine";
import type { BeatAnalysisResult } from "../audio/beat-detection-engine";

const engine = new BeatSyncEngine();
const analysis: BeatAnalysisResult = {
  bpm: 120, confidence: 0.9, duration: 10, downbeats: [0.25, 2.25],
  beats: Array.from({ length: 20 }, (_, index) => ({ time: 0.25 + index * 0.5, index, strength: 1 })),
};
const clip = (id: string, startTime: number, duration = 4, trackId = "video") => ({ id, startTime, duration, trackId });

describe("video cuts to music beats", () => {
  it("trims and arranges clips in timeline order with contiguous four-beat boundaries", () => {
    const result = engine.calculateSyncedTimings([clip("b", 8), clip("a", 2)], analysis, 5, DEFAULT_BEAT_SYNC_CONFIG);
    expect(result.map((item) => [item.clipId, item.newStartTime, item.newDuration])).toEqual([
      ["a", 5.25, 2], ["b", 7.25, 2],
    ]);
  });
  it.each([1, 2, 4, 8] as const)("supports a cut every %s beats", (beatsPerClip) => {
    const result = engine.calculateSyncedTimings([clip("a", 0)], analysis, 0, { ...DEFAULT_BEAT_SYNC_CONFIG, beatsPerClip });
    expect(result[0].newDuration).toBe(beatsPerClip * 0.5);
  });
  it("keeps parallel video tracks aligned to the same music", () => {
    const result = engine.calculateSyncedTimings([clip("a", 0), clip("b", 0, 4, "layer")], analysis, 0, DEFAULT_BEAT_SYNC_CONFIG);
    expect(result.map((item) => item.newStartTime)).toEqual([0.25, 0.25]);
  });
  it("rejects source extension and insufficient music instead of silently skipping clips", () => {
    expect(() => engine.calculateSyncedTimings([clip("a", 0, 1)], analysis, 0, DEFAULT_BEAT_SYNC_CONFIG)).toThrow("too short");
    expect(() => engine.calculateSyncedTimings(Array.from({ length: 5 }, (_, i) => clip(String(i), i)), analysis, 0, DEFAULT_BEAT_SYNC_CONFIG)).toThrow("Not enough beats");
  });
  it("uses detected irregular beat times and applies the offset once", () => {
    const irregular = { ...analysis, beats: [0.2, 0.7, 1.3].map((time, index) => ({ time, index, strength: 1 })) };
    const result = engine.calculateSyncedTimings([clip("a", 0), clip("b", 5)], irregular, 3, {
      ...DEFAULT_BEAT_SYNC_CONFIG, beatsPerClip: 1, offsetMs: 100,
    });
    expect(result[0].newStartTime).toBeCloseTo(3.3);
    expect(result[1].newStartTime).toBeCloseTo(3.8);
    expect(result[1].newDuration).toBeCloseTo(0.6);
  });
  it("does not cut outside the trimmed music with a negative offset", () => {
    const result = engine.calculateSyncedTimings([clip("a", 0)], analysis, 0, {
      ...DEFAULT_BEAT_SYNC_CONFIG, offsetMs: -500,
    });
    expect(result[0].newStartTime).toBe(0.25);
  });
  it("returns no edits for empty or silent beat results", () => {
    expect(engine.calculateSyncedTimings([clip("a", 0)], { ...analysis, beats: [] }, 0, DEFAULT_BEAT_SYNC_CONFIG)).toEqual([]);
  });
});
