import { describe, expect, it } from "vitest";
import type { Clip, MediaItem } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { createCaptionSourceSummarySelector, resolveCaptionSource } from "./caption-source";

function fixture() {
  const empty = createEmptyProject("Caption source selection", undefined, true);
  const media = (id: string, type: MediaItem["type"]): MediaItem => ({
    id, type, name: `${id}.mp4`, fileHandle: null, blob: new Blob([id]),
    thumbnailUrl: null, waveformData: null,
    metadata: { duration: 20, width: 640, height: 360, frameRate: 30,
      codec: "fixture", sampleRate: 48000, channels: 2, fileSize: 1 },
  });
  const makeClip = (id: string, mediaId: string, trackId: string, startTime: number): Clip => ({
    id, mediaId, trackId, startTime, duration: 2, inPoint: 0, outPoint: 2,
    volume: 1, effects: [], audioEffects: [], keyframes: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 },
      anchor: { x: .5, y: .5 }, rotation: 0, opacity: 1 },
  });
  const tracks = empty.timeline.tracks.map(track => ({ ...track, clips:
    track.name === "Dialogue" ? [makeClip("later", "voice", track.id, 12), makeClip("early", "voice", track.id, 2),
      makeClip("image", "image", track.id, 8), makeClip("missing", "unknown", track.id, 9)] :
      track.name === "Main" ? [makeClip("video", "video", track.id, 0)] : [],
  }));
  return { ...empty, mediaLibrary: { items: [media("video", "video"), media("voice", "audio"), media("image", "image")] },
    timeline: { ...empty.timeline, tracks } };
}

describe("caption workspace source", () => {
  it("uses every eligible dialogue clip in timeline order and describes the actual track", () => {
    const project = fixture();
    const dialogue = project.timeline.tracks.find(track => track.name === "Dialogue")!;
    const source = resolveCaptionSource(project, [{ type: "text-clip", id: "title" }]);
    expect(source).toEqual({ clipIds: ["early", "later"], sourceTrackId: dialogue.id,
      sourceLabel: "Dialogue", summary: "From dialogue on A1 · 2 clips" });
    expect(dialogue.clips.map(clip => clip.id)).toEqual(["later", "early", "image", "missing"]);
  });
  it("preserves explicit single-clip captioning when video and linked audio are selected", () => {
    const source = resolveCaptionSource(fixture(), [{ type: "clip", id: "video" }, { type: "clip", id: "early" }]);
    expect(source).toEqual({ clipIds: ["video"], sourceTrackId: undefined,
      sourceLabel: "video.mp4", summary: "From selected clip · video.mp4" });
  });
  it("uses dialogue when the selected visual has no transcribable audio", () => {
    expect(resolveCaptionSource(fixture(), [{ type: "clip", id: "image" }]).clipIds).toEqual(["early", "later"]);
  });
  it("retains the existing first audio/video fallback without a dialogue source", () => {
    const project = fixture();
    const withoutDialogue = { ...project, timeline: { ...project.timeline,
      tracks: project.timeline.tracks.map(track => track.name === "Dialogue" ? { ...track, clips: [] } : track),
    } };
    expect(resolveCaptionSource(withoutDialogue, [])).toMatchObject({ clipIds: ["video"], sourceTrackId: undefined,
      sourceLabel: "video.mp4", summary: "From video.mp4" });
  });
  it("refreshes summaries for published versions that reuse mutable source arrays", () => {
    const project = fixture();
    const read = createCaptionSourceSummarySelector([]);
    expect(read(project)).toBe("From dialogue on A1 · 2 clips");
    const dialogue = project.timeline.tracks.find((track) => track.name === "Dialogue")!;
    dialogue.clips.push({ ...dialogue.clips[0], id: "third" });
    expect(read({ ...project })).toBe("From dialogue on A1 · 3 clips");
  });
  it("refreshes selected source names when a new version reuses the media array", () => {
    const project = fixture();
    const read = createCaptionSourceSummarySelector([{ type: "clip", id: "video" }]);
    expect(read(project)).toBe("From selected clip · video.mp4");
    const index = project.mediaLibrary.items.findIndex((item) => item.id === "video");
    project.mediaLibrary.items[index] = { ...project.mediaLibrary.items[index], name: "Renamed.mp4" };
    expect(read({ ...project })).toBe("From selected clip · Renamed.mp4");
  });
});
