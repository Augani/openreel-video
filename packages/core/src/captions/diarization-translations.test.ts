import { describe, expect, it } from "vitest";
import { detectionCues, mirrorSpeakersToTranslations } from "./diarization";
import type { Subtitle } from "../types/timeline";

const cue = (id: string, start: number, end: number, extra: Partial<Subtitle> = {}): Subtitle => ({
  id,
  text: id,
  startTime: start,
  endTime: end,
  words: [],
  ...extra,
});
const source = [cue("a", 0, 2), cue("b", 2, 4)];
const translated = [
  cue("fa", 0, 2, { captionTrackId: "fr", language: "fr", hidden: true }),
  cue("fb", 2, 4, { captionTrackId: "fr", language: "fr", hidden: true }),
];

describe("detectionCues", () => {
  it("analyses only the visible track", () => {
    expect(detectionCues([...source, ...translated]).map((c) => c.id)).toEqual(["a", "b"]);
    expect(detectionCues([...translated, ...source]).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("falls back to the first track when everything is hidden", () => {
    const hidden = [...source, ...translated].map((c) => ({ ...c, hidden: true }));
    expect(detectionCues(hidden).map((c) => c.id)).toEqual(["a", "b"]);
    expect(detectionCues([])).toEqual([]);
  });
});

describe("mirrorSpeakersToTranslations", () => {
  it("copies speakers onto translated cues of the same range, and clears them", () => {
    const labelled = [{ ...source[0], speaker: "Ann" }, { ...source[1], speaker: "Bob" }, ...translated];
    const out = mirrorSpeakersToTranslations(labelled, new Set(["a", "b"]));
    expect(out.map((c) => c.speaker)).toEqual(["Ann", "Bob", "Ann", "Bob"]);
    const out2 = mirrorSpeakersToTranslations(
      [source[0], labelled[1], { ...translated[0], speaker: "Ann" }, translated[1]],
      new Set(["a"]),
    );
    expect(out2[2].speaker).toBeUndefined();
  });

  it("does not touch cues whose range differs", () => {
    const other = cue("x", 5, 6, { captionTrackId: "fr", hidden: true });
    const out = mirrorSpeakersToTranslations([{ ...source[0], speaker: "Ann" }, other], new Set(["a"]));
    expect(out[1].speaker).toBeUndefined();
  });
});
