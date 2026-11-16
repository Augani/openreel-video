import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_TRANSFORM, type Clip, type MediaItem, type Project, type TextClip, type Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { buildPreviewLabelIndex, previewLabelAt } from "./active-layer-label";

const media = (id: string, type: MediaItem["type"] = "video"): MediaItem => ({
  id, name: `${id}.${type === "audio" ? "wav" : type === "image" ? "png" : "mp4"}`, type,
  blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 41, width: 1920, height: 1080, frameRate: 30,
    codec: "", sampleRate: 48000, channels: 2, fileSize: 1, hasVideo: type === "video" },
});
const clip = (id: string, trackId: string, mediaId: string, startTime: number, duration: number): Clip => ({
  id, trackId, mediaId, startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], keyframes: [], volume: 1, transform: DEFAULT_TEXT_TRANSFORM,
});
const track = (id: string, clips: Clip[] = []): Track => ({
  id, name: id, type: "video", clips, transitions: [],
  hidden: false, locked: false, muted: false, solo: false,
});
const title: TextClip = {
  id: "title", trackId: "titles", startTime: 27, duration: 4, text: "Golden\nHour",
  style: DEFAULT_TEXT_STYLE, transform: DEFAULT_TEXT_TRANSFORM, keyframes: [],
};
function project(): Project {
  const empty = createEmptyProject("Layer names");
  return { ...empty, mediaLibrary: { items: [media("main"), media("broll"), media("voice", "audio")] },
    textClips: [title], timeline: { ...empty.timeline, tracks: [
      track("titles"), track("broll", [clip("drone", "broll", "broll", 4, 4.5)]),
      track("main", [clip("interview", "main", "main", 0, 41)]),
      track("voice", [clip("dialogue", "voice", "voice", 0, 41)]),
    ] } };
}

describe("preview active layer labels", () => {
  it("follows visual layers, title timing and exact boundaries through forward/backward seeks", () => {
    const p = project();
    const index = buildPreviewLabelIndex(p);
    expect([0, 4, 8.499, 8.5, 27, 30.999, 31, 41, 4].map(time => previewLabelAt(index, time)))
      .toEqual(["main.mp4", "broll.mp4", "broll.mp4", "main.mp4", "Title · Golden Hour", "Title · Golden Hour", "main.mp4", undefined, "broll.mp4"]);
    expect(buildPreviewLabelIndex({ ...p, mediaLibrary: { items: [...p.mediaLibrary.items].reverse() } })).toEqual(index);
  });

  it("ignores hidden, fully transparent and audio-only layers and respects track reorder", () => {
    const p = project();
    const tracks = p.timeline.tracks;
    const hidden = { ...p, timeline: { ...p.timeline, tracks: tracks.map(t => ({ ...t, hidden: t.id === "titles" || t.id === "broll" })) } };
    expect(previewLabelAt(buildPreviewLabelIndex(hidden), 28.5)).toBe("main.mp4");
    const invisible = { ...p, textClips: [{ ...title, transform: { ...title.transform, opacity: 0 } }] };
    expect(previewLabelAt(buildPreviewLabelIndex(invisible), 28.5)).toBe("main.mp4");
    const reordered = { ...p, timeline: { ...p.timeline, tracks: [tracks[2], tracks[0], tracks[1], tracks[3]] } };
    expect(previewLabelAt(buildPreviewLabelIndex(reordered), 28.5)).toBe("main.mp4");
    const audio = { ...p, timeline: { ...p.timeline, tracks: [tracks[3]] } };
    expect(buildPreviewLabelIndex(audio)).toEqual([]);
  });

});
