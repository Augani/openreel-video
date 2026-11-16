import { describe, expect, it } from "vitest";
import type { MediaItem, Project } from "../types/project";
import type { Clip } from "../types/timeline";
import { planInvalidation } from "./invalidation-planner";
import { buildPixelModel, stableStringify } from "./pixel-entities";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };
const blob = new Blob(["m1"]);

function media(extra: Partial<MediaItem> = {}, metaExtra: Partial<MediaItem["metadata"]> = {}): MediaItem {
  return {
    id: "m1", name: "m1", type: "video", fileHandle: null, blob,
    metadata: { duration: 30, width: 1440, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1, ...metaExtra },
    thumbnailUrl: null, waveformData: null, ...extra,
  };
}
const clip = (id: string, start: number, duration: number): Clip => ({
  id, mediaId: "m1", trackId: "v1", startTime: start, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
function project(item: MediaItem, settings: Partial<Project["settings"]> = {}): Project {
  return {
    id: "p1", name: "T", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2, ...settings },
    mediaLibrary: { items: [item] },
    timeline: {
      tracks: [{ id: "v1", type: "video", name: "v1", clips: [clip("c1", 0, 4), clip("c2", 10, 2)], transitions: [], locked: false, hidden: false, muted: false, solo: false }],
      subtitles: [], markers: [], duration: 12,
    },
  };
}

describe("render cache keys include pixel aspect and field order", () => {
  it("changing a media item's interpretation invalidates exactly the spans of the clips using it", () => {
    const before = project(media());
    for (const interpretation of [{ pixelAspectRatio: 4 / 3 }, { fieldOrder: "upper" as const }, { deinterlace: "bob" as const }]) {
      const plan = planInvalidation(before, project(media({ interpretation })));
      expect(plan.all).toBe(false);
      expect(plan.ranges).toEqual([{ start: 0, end: 4 }, { start: 10, end: 12 }]);
    }
  });

  it("changing the file's reported pixel aspect or field order invalidates the clips", () => {
    const before = project(media());
    expect(planInvalidation(before, project(media({}, { pixelAspectRatio: 4 / 3 }))).ranges.length).toBe(2);
    expect(planInvalidation(before, project(media({}, { fieldOrder: "lower" }))).ranges.length).toBe(2);
  });

  it("changing the sequence pixel aspect or field order invalidates every frame", () => {
    const before = project(media());
    expect(planInvalidation(before, project(media(), { pixelAspectRatio: 4 / 3 })).all).toBe(true);
    expect(planInvalidation(before, project(media(), { fieldOrder: "upper" })).all).toBe(true);
  });

  it("legacy projects keep their keys: absent or undefined fields add nothing", () => {
    const legacy = project(media());
    const explicitUndefined = project(media({ interpretation: undefined }, { pixelAspectRatio: undefined }), { pixelAspectRatio: undefined, fieldOrder: undefined });
    expect(planInvalidation(legacy, explicitUndefined)).toEqual({ all: false, ranges: [] });
    const model = buildPixelModel(legacy);
    expect(model.globalFingerprint).toBe(stableStringify({ width: 1920, height: 1080, frameRate: 30, projectRest: {}, timelineRest: {} }));
    const keys = [...model.entities.values()].map((e) => e.fingerprint).join("|");
    expect(keys).not.toContain("metaPixelAspectRatio");
    expect(keys).not.toContain("interpretation");
  });
});
