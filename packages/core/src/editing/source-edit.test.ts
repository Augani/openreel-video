import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import type { MediaItem } from "../types/project";
import { planSourceEdit, resolveThreePointEdit, sourceDropError, sourceTargetKind } from "./source-edit";
import {
  applyTimelineToolEdits,
  invertTimelineToolEdits,
  validateTimelineToolEdits,
} from "./timeline-tool-edit";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  rotation: 0,
  opacity: 1,
};
const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id,
  mediaId: "m",
  trackId,
  startTime,
  duration,
  inPoint: 0,
  outPoint: duration,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
});
const track = (id: string, type: Track["type"], clips: Clip[]): Track => ({
  id,
  name: id,
  type,
  mode: "standard",
  role: "general",
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});
const media = {
  id: "m",
  name: "m.mp4",
  type: "video",
  fileHandle: null,
  blob: null,
  thumbnailUrl: null,
  waveformData: null,
  metadata: { duration: 20, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, codec: "h264", fileSize: 1 },
} as unknown as MediaItem;
const project = {
  id: "p",
  name: "p",
  createdAt: 0,
  modifiedAt: 0,
  settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [media] },
  timeline: {
    duration: 10,
    markers: [],
    subtitles: [],
    tracks: [
      track("main", "video", [clip("a", "main", 0, 4), clip("b", "main", 4, 6)]),
      track("broll", "video", [clip("c", "broll", 2, 6)]),
    ],
  },
} as unknown as Project;

const base = { mediaDuration: 20, playhead: 3 };

describe("resolveThreePointEdit", () => {
  it("two-point: source range at the playhead", () => {
    expect(resolveThreePointEdit({ ...base, sourceIn: 2, sourceOut: 5 })).toMatchObject({
      at: 3, sourceIn: 2, sourceOut: 5, duration: 3, rule: "source-range-at-playhead",
    });
  });
  it("unmarked source defaults to the whole media", () => {
    expect(resolveThreePointEdit(base)).toMatchObject({ sourceIn: 0, sourceOut: 20 });
  });
  it("source range + sequence In starts at the sequence In", () => {
    expect(resolveThreePointEdit({ ...base, sourceIn: 2, sourceOut: 5, sequenceIn: 7 })).toMatchObject({
      at: 7, duration: 3, rule: "source-range-at-sequence-in",
    });
  });
  it("source range + sequence Out is back-timed to end at the Out", () => {
    expect(resolveThreePointEdit({ ...base, sourceIn: 2, sourceOut: 5, sequenceOut: 9 })).toMatchObject({
      at: 6, sourceIn: 2, sourceOut: 5, rule: "source-range-ends-at-sequence-out",
    });
    // Not enough room before 0: the head of the source range is trimmed.
    expect(resolveThreePointEdit({ ...base, sourceIn: 2, sourceOut: 5, sequenceOut: 2 })).toMatchObject({
      at: 0, sourceIn: 3, sourceOut: 5, duration: 2,
    });
  });
  it("source In + sequence range fits Out from the sequence length", () => {
    expect(resolveThreePointEdit({ ...base, sourceIn: 4, sequenceIn: 10, sequenceOut: 12.5 })).toMatchObject({
      at: 10, sourceIn: 4, sourceOut: 6.5, rule: "fit-source-in",
    });
    // Source shorter than the sequence range: clipped, not padded.
    expect(resolveThreePointEdit({ ...base, sourceIn: 19, sequenceIn: 10, sequenceOut: 15 })).toMatchObject({
      sourceOut: 20, duration: 1,
    });
  });
  it("source Out + sequence range back-times the In", () => {
    expect(resolveThreePointEdit({ ...base, sourceOut: 8, sequenceIn: 10, sequenceOut: 13 })).toMatchObject({
      at: 10, sourceIn: 5, sourceOut: 8, rule: "fit-source-out",
    });
    expect(resolveThreePointEdit({ ...base, sourceOut: 2, sequenceIn: 10, sequenceOut: 15 })).toMatchObject({
      at: 13, sourceIn: 0, sourceOut: 2,
    });
  });
  it("no source marks + sequence range fits from the media start", () => {
    expect(resolveThreePointEdit({ ...base, sequenceIn: 1, sequenceOut: 4 })).toMatchObject({
      at: 1, sourceIn: 0, sourceOut: 3, rule: "fit-media",
    });
  });
  it("four-point: the source range wins at the sequence In", () => {
    expect(
      resolveThreePointEdit({ ...base, sourceIn: 1, sourceOut: 2, sequenceIn: 5, sequenceOut: 9 }),
    ).toMatchObject({ at: 5, duration: 1, rule: "four-point" });
  });
  it("rejects empty or inverted ranges", () => {
    expect(() => resolveThreePointEdit({ ...base, sourceIn: 5, sourceOut: 5 })).toThrow();
    expect(() => resolveThreePointEdit({ ...base, sequenceIn: 5, sequenceOut: 4 })).toThrow();
  });
});

describe("planSourceEdit", () => {
  const apply = (p: Project, edits: Parameters<typeof applyTimelineToolEdits>[1]) => {
    validateTimelineToolEdits(p, edits);
    return applyTimelineToolEdits(p, edits);
  };
  it("insert ripples the target track and undo restores the project exactly", () => {
    const { plan, resolved } = planSourceEdit(project, {
      mode: "insert", media, trackId: "main", clipId: "n", operationId: "op",
      sourceIn: 5, sourceOut: 7, playhead: 4,
    });
    expect(resolved.at).toBe(4);
    const after = apply(project, plan.edits);
    const main = after.timeline.tracks.find((t) => t.id === "main")!;
    const sorted = [...main.clips].sort((x, y) => x.startTime - y.startTime);
    expect(sorted.map((c) => [c.startTime, c.duration])).toEqual([[0, 4], [4, 2], [6, 6]]);
    expect(sorted[1]).toMatchObject({ id: "n", inPoint: 5, outPoint: 7 });
    const back = apply(after, invertTimelineToolEdits(plan.edits));
    expect(JSON.stringify(back.timeline.tracks.map((t) => [t.id, [...t.clips].sort((x, y) => x.startTime - y.startTime)])))
      .toBe(JSON.stringify(project.timeline.tracks.map((t) => [t.id, [...t.clips].sort((x, y) => x.startTime - y.startTime)])));
  });
  it("overwrite replaces only the target track", () => {
    const { plan } = planSourceEdit(project, {
      mode: "overwrite", media, trackId: "broll", clipId: "n", operationId: "op",
      sourceIn: 0, sourceOut: 2, playhead: 3,
    });
    const after = apply(project, plan.edits);
    expect(after.timeline.tracks.find((t) => t.id === "main")!.clips).toHaveLength(2);
    const broll = [...after.timeline.tracks.find((t) => t.id === "broll")!.clips].sort((x, y) => x.startTime - y.startTime);
    expect(broll.map((c) => [c.startTime, c.duration])).toEqual([[2, 1], [3, 2], [5, 3]]);
  });
  it("video-only mutes and audio-only hides the clip", () => {
    const video = planSourceEdit(project, {
      mode: "overwrite", media, trackId: "broll", clipId: "v", operationId: "o",
      playhead: 0, sourceIn: 0, sourceOut: 1, component: "video",
    });
    expect(video.clip.volume).toBe(0);
    expect(video.clip.transform.opacity).toBe(1);
    const audio = planSourceEdit(project, {
      mode: "overwrite", media, trackId: "broll", clipId: "u", operationId: "o",
      playhead: 0, sourceIn: 0, sourceOut: 1, component: "audio",
    });
    expect(audio.clip.volume).toBe(1);
    expect(audio.clip.transform.opacity).toBe(0);
  });
});

describe("sourceDropError", () => {
  const video = { type: "video" } as const;
  const audio = { type: "audio" } as const;
  const tracks = project.timeline.tracks;
  it("accepts video on a video track and refuses audio/text/graphics lanes", () => {
    expect(sourceDropError(tracks[0], video)).toBeNull();
    expect(sourceDropError(track("a", "audio", []), video)).not.toBeNull();
    expect(sourceDropError(track("t", "text", []), video)).not.toBeNull();
    expect(sourceDropError(track("g", "graphics", []), video, "video")).not.toBeNull();
  });
  it("audio-only and audio media need an audio track", () => {
    expect(sourceDropError(track("a", "audio", []), video, "audio")).toBeNull();
    expect(sourceDropError(tracks[0], video, "audio")).not.toBeNull();
    expect(sourceDropError(track("a", "audio", []), audio)).toBeNull();
    expect(sourceDropError(tracks[0], audio)).not.toBeNull();
    expect(sourceTargetKind(video, "audio")).toBe("audio");
  });
  it("refuses locked tracks and missing tracks", () => {
    expect(sourceDropError({ ...tracks[0], locked: true }, video)).toMatch(/Unlock/);
    expect(sourceDropError(undefined, video)).not.toBeNull();
  });
});
