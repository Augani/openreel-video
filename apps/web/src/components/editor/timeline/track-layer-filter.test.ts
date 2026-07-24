import { describe, expect, it } from "vitest";
import type { Track } from "@openreel/core";
import { filterTrackLayerEntries } from "./track-layer-filter";

const tracks = [
  { id: "v1", name: "Main Camera", type: "video" },
  { id: "t1", name: "Captions", type: "text" },
  { id: "a1", name: "Voice Over", type: "audio" },
] as Track[];

describe("filterTrackLayerEntries", () => {
  it("searches names and types while preserving original reorder positions", () => {
    expect(filterTrackLayerEntries(tracks, "voice", "all")).toEqual([
      { track: tracks[2], index: 2 },
    ]);
    expect(filterTrackLayerEntries(tracks, "video", "all")).toEqual([
      { track: tracks[0], index: 0 },
    ]);
  });

  it("combines type and text filters", () => {
    expect(filterTrackLayerEntries(tracks, "cap", "text")).toEqual([
      { track: tracks[1], index: 1 },
    ]);
    expect(filterTrackLayerEntries(tracks, "camera", "audio")).toEqual([]);
  });
});
