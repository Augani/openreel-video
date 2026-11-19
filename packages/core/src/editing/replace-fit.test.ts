import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import type { MediaItem } from "../types/project";
import {
  findReplaceTarget,
  planFitToFill,
  planReplaceEdit,
  resolveFitToFill,
} from "./replace-fit";
import { CLIP_SPEED_MAX } from "./speed-limits";
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
const clip = (id: string, trackId: string, startTime: number, duration: number, extra: Partial<Clip> = {}): Clip => ({
  id,
  mediaId: "old",
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
  ...extra,
});
const track = (id: string, type: Track["type"], clips: Clip[], extra: Partial<Track> = {}): Track => ({
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
  ...extra,
});
const mediaItem = (id: string, type: MediaItem["type"], duration: number, hasAudio = true) =>
  ({
    id,
    name: `${id}.mp4`,
    type,
    fileHandle: null,
    blob: null,
    thumbnailUrl: null,
    waveformData: null,
    metadata: { duration, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, codec: "h264", fileSize: 1, hasAudio },
  }) as unknown as MediaItem;

const src = mediaItem("src", "video", 20);
const still = mediaItem("still", "image", 5, false);
const music = mediaItem("music", "audio", 30);

const effect = { id: "fx1", type: "blur", params: { radius: 4 }, enabled: true };
const key = { id: "k1", time: 1, property: "opacity", value: 0.5, easing: "linear" };
const graded = clip("b", "main", 4, 6, {
  effects: [effect],
  keyframes: [key as never],
  volume: 0.6,
  speed: 2,
  speedKeyframes: [{ id: "s1", time: 0, speed: 2, easing: "linear" }],
  metadata: { custom: "keep-me" },
});

const base = {
  id: "p",
  name: "p",
  createdAt: 0,
  modifiedAt: 0,
  settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [src, still, music] },
  timeline: {
    duration: 12,
    markers: [],
    subtitles: [],
    tracks: [
      track("main", "video", [clip("a", "main", 0, 4), graded]),
      track("broll", "video", [clip("c", "broll", 2, 6)]),
      track("a1", "audio", [clip("snd", "a1", 4, 6, { speed: 2, metadata: { separatedFromClipId: "b" } })]),
    ],
  },
} as unknown as Project;

const apply = (p: Project, edits: Parameters<typeof applyTimelineToolEdits>[1]) => {
  validateTimelineToolEdits(p, edits);
  return applyTimelineToolEdits(p, edits);
};
const find = (p: Project, id: string) => p.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
const snapshot = (p: Project) =>
  JSON.stringify(p.timeline.tracks.map((t) => [t.id, [...t.clips].sort((x, y) => x.startTime - y.startTime)]));

describe("resolveFitToFill", () => {
  it("speeds a long source into a short range", () => {
    expect(resolveFitToFill({ mediaDuration: 20, sourceIn: 2, sourceOut: 12, sequenceIn: 3, sequenceOut: 8 })).toMatchObject({
      at: 3, sourceIn: 2, sourceOut: 12, duration: 5, speed: 2,
    });
  });
  it("slows a short source down across a long range", () => {
    expect(resolveFitToFill({ mediaDuration: 20, sourceIn: 0, sourceOut: 2, sequenceIn: 0, sequenceOut: 8 }).speed).toBeCloseTo(0.25);
  });
  it("uses the whole media when the source is unmarked", () => {
    expect(resolveFitToFill({ mediaDuration: 20, sequenceIn: 1, sequenceOut: 11 })).toMatchObject({ sourceIn: 0, sourceOut: 20, speed: 2 });
  });
  it("is a plain overwrite at 100% when the lengths match", () => {
    expect(resolveFitToFill({ mediaDuration: 20, sourceIn: 1, sourceOut: 4, sequenceIn: 0, sequenceOut: 3 }).speed).toBe(1);
  });
  it("refuses speeds outside the clip speed limits, naming the speed", () => {
    expect(() => resolveFitToFill({ mediaDuration: 400, sourceIn: 0, sourceOut: 400, sequenceIn: 0, sequenceOut: 10 })).toThrow(/4000%/);
    expect(() => resolveFitToFill({ mediaDuration: 20, sourceIn: 0, sourceOut: 0.5, sequenceIn: 0, sequenceOut: 10 })).toThrow(/5%/);
    expect(CLIP_SPEED_MAX).toBe(20);
  });
  it("needs both timeline marks", () => {
    expect(() => resolveFitToFill({ mediaDuration: 20, sequenceIn: 1, sequenceOut: Number.NaN })).toThrow(/In and Out/);
    expect(() => resolveFitToFill({ mediaDuration: 20, sequenceIn: 4, sequenceOut: 4 })).toThrow(/after the sequence In/);
  });
});

describe("planFitToFill", () => {
  const request = { media: src, trackId: "broll", clipId: "n", operationId: "op" };
  it("fills the range with a retimed clip whose duration equals the range", () => {
    const { plan, resolved, clip: placed } = planFitToFill(base, {
      ...request, sourceIn: 0, sourceOut: 10, sequenceIn: 1, sequenceOut: 6,
    });
    expect(plan.label).toBe("Fit to Fill");
    expect(resolved.speed).toBe(2);
    expect(placed).toMatchObject({ startTime: 1, duration: 5, inPoint: 0, outPoint: 10, speed: 2 });
    const after = apply(base, plan.edits);
    const broll = [...after.timeline.tracks.find((t) => t.id === "broll")!.clips].sort((x, y) => x.startTime - y.startTime);
    // "c" (2..8) is overwritten inside 1..6 and keeps its tail 6..8.
    expect(broll.map((c) => [c.id === "n" ? "n" : "tail", c.startTime, c.duration])).toEqual([["n", 1, 5], ["tail", 6, 2]]);
    const n = broll[0];
    expect((n.outPoint - n.inPoint) / (n.speed ?? 1)).toBeCloseTo(n.duration);
    expect(n.pitchCorrection).toBeUndefined(); // engine default: pitch preserved
  });
  it("leaves the speed unset at 100%", () => {
    const { clip: placed } = planFitToFill(base, { ...request, sourceIn: 3, sourceOut: 8, sequenceIn: 0, sequenceOut: 5 });
    expect(placed.speed).toBeUndefined();
  });
  it("is one undo step that restores the project exactly", () => {
    const { plan } = planFitToFill(base, { ...request, sourceIn: 0, sourceOut: 10, sequenceIn: 1, sequenceOut: 6 });
    const after = apply(base, plan.edits);
    expect(snapshot(apply(after, invertTimelineToolEdits(plan.edits)))).toBe(snapshot(base));
  });
  it("does not ripple: the other tracks and later clips stay put", () => {
    const { plan } = planFitToFill(base, { ...request, sourceIn: 0, sourceOut: 10, sequenceIn: 1, sequenceOut: 6 });
    const after = apply(base, plan.edits);
    expect(find(after, "b")).toMatchObject({ startTime: 4 });
    expect(find(after, "snd")).toMatchObject({ startTime: 4 });
  });
  it("patches video and audio to separate tracks at the same speed, linked", () => {
    const { plan } = planFitToFill(base, {
      ...request, trackId: "broll", sourceIn: 0, sourceOut: 10, sequenceIn: 1, sequenceOut: 6,
      audioPatch: { trackId: "a1", clipId: "n-audio" },
    });
    const after = apply(base, plan.edits);
    expect(find(after, "n")).toMatchObject({ speed: 2, duration: 5, volume: 0 });
    expect(find(after, "n-audio")).toMatchObject({ speed: 2, duration: 5, startTime: 1 });
    expect(find(after, "n-audio").metadata?.separatedFromClipId).toBe("n");
  });
  it("audio-only sources retime on an audio track", () => {
    const { clip: placed } = planFitToFill(base, { ...request, media: music, trackId: "a1", sourceIn: 0, sourceOut: 12, sequenceIn: 0, sequenceOut: 6 });
    expect(placed).toMatchObject({ speed: 2, duration: 6 });
  });
  it("refuses stills, locked tracks and out-of-range speeds", () => {
    expect(() => planFitToFill(base, { ...request, media: still, sequenceIn: 0, sequenceOut: 4 })).toThrow(/video or audio/);
    const locked = { ...base, timeline: { ...base.timeline, tracks: base.timeline.tracks.map((t) => (t.id === "broll" ? { ...t, locked: true } : t)) } } as Project;
    expect(() => planFitToFill(locked, { ...request, sourceIn: 0, sourceOut: 10, sequenceIn: 1, sequenceOut: 6 })).toThrow(/Unlock/);
    expect(() => planFitToFill(base, { ...request, sourceIn: 0, sourceOut: 20, sequenceIn: 0, sequenceOut: 0.5 })).toThrow(/speed/);
  });
  it("honours a restricted subclip window", () => {
    const sub = { ...src, subclip: { sourceMediaId: "src", inPoint: 4, outPoint: 8, restrictTrims: true } } as unknown as MediaItem;
    const { resolved } = planFitToFill(base, { ...request, media: sub, sequenceIn: 0, sequenceOut: 8 });
    expect(resolved).toMatchObject({ sourceIn: 4, sourceOut: 8, speed: 0.5 });
  });
});

describe("planReplaceEdit", () => {
  const request = { clipId: "b", media: src, alignment: "in" as const, playhead: 5, sourcePosition: 9, keepAttributes: true };
  it("keeps position and duration, swaps the footage, aligned at the source In", () => {
    const { plan, resolved } = planReplaceEdit(base, { ...request, sourceIn: 3 });
    expect(resolved).toMatchObject({ clipId: "b", at: 4, duration: 6, sourceIn: 3, sourceOut: 9, fellBackToIn: false });
    const after = apply(base, plan.edits);
    expect(find(after, "b")).toMatchObject({ id: "b", mediaId: "src", startTime: 4, duration: 6, inPoint: 3, outPoint: 9 });
    expect(find(after, "a")).toEqual(find(base, "a"));
  });
  it("aligns the Source playhead frame to the timeline playhead", () => {
    // Playhead 1s into the clip; source frame 9 sits there, so the clip starts at 8.
    const { resolved } = planReplaceEdit(base, { ...request, alignment: "playhead" });
    expect(resolved).toMatchObject({ sourceIn: 8, sourceOut: 14 });
  });
  it("falls back to the In point when the playhead is outside the clip", () => {
    const { resolved } = planReplaceEdit(base, { ...request, alignment: "playhead", playhead: 1, sourceIn: 2 });
    expect(resolved).toMatchObject({ sourceIn: 2, fellBackToIn: true });
  });
  it("keeps effects, keyframes, volume and metadata but drops the old footage's speed", () => {
    const { plan } = planReplaceEdit(base, request);
    const out = find(apply(base, plan.edits), "b");
    expect(out.effects).toEqual([effect]);
    expect(out.keyframes).toEqual([key]);
    expect(out.volume).toBe(0.6);
    expect(out.metadata?.custom).toBe("keep-me");
    expect(out.speed).toBeUndefined();
    expect(out.speedKeyframes).toBeUndefined();
    expect(out.outPoint - out.inPoint).toBeCloseTo(out.duration);
  });
  it("resets the clip to a fresh one when attributes are not kept", () => {
    const { plan } = planReplaceEdit(base, { ...request, keepAttributes: false });
    const out = find(apply(base, plan.edits), "b");
    expect(out).toMatchObject({ effects: [], keyframes: [], volume: 1, startTime: 4, duration: 6, mediaId: "src" });
    expect(out.speed).toBeUndefined();
  });
  it("replaces the linked audio together with the picture", () => {
    const linkedBase = {
      ...base,
      timeline: {
        ...base.timeline,
        tracks: base.timeline.tracks.map((t) =>
          t.id === "a1" ? { ...t, clips: t.clips.map((c) => ({ ...c, mediaId: "old" })) } : t),
      },
    } as Project;
    const { plan, resolved } = planReplaceEdit(linkedBase, request);
    expect(resolved.linkedClipIds).toEqual(["snd"]);
    const after = apply(linkedBase, plan.edits);
    expect(find(after, "snd")).toMatchObject({ mediaId: "src", startTime: 4, duration: 6, inPoint: 0, outPoint: 6 });
  });
  it("is one undo step that restores the project exactly", () => {
    const { plan } = planReplaceEdit(base, request);
    expect(plan.label).toBe("Replace");
    const after = apply(base, plan.edits);
    expect(snapshot(after)).not.toBe(snapshot(base));
    expect(snapshot(apply(after, invertTimelineToolEdits(plan.edits)))).toBe(snapshot(base));
  });
  it("keeps transitions attached (the clip id survives)", () => {
    const withTransition = {
      ...base,
      timeline: {
        ...base.timeline,
        tracks: base.timeline.tracks.map((t) =>
          t.id === "main" ? { ...t, transitions: [{ id: "t", clipAId: "a", clipBId: "b", type: "crossfade", duration: 1, params: {} }] } : t),
      },
    } as unknown as Project;
    const { plan } = planReplaceEdit(withTransition, request);
    expect(plan.edits.every((e) => e.kind !== "transition")).toBe(true);
  });
  it("refuses when the source is too short, ahead of its start, locked, or the wrong kind", () => {
    expect(() => planReplaceEdit(base, { ...request, sourceIn: 18 })).toThrow(/from that point/);
    expect(() => planReplaceEdit(base, { ...request, alignment: "playhead", sourcePosition: 0.5 })).toThrow(/Not enough source before/);
    const locked = { ...base, timeline: { ...base.timeline, tracks: base.timeline.tracks.map((t) => (t.id === "main" ? { ...t, locked: true } : t)) } } as Project;
    expect(() => planReplaceEdit(locked, request)).toThrow(/Unlock/);
    expect(() => planReplaceEdit(base, { ...request, media: music })).toThrow(/audio track/i);
    expect(() => planReplaceEdit(base, { ...request, clipId: "missing" })).toThrow(/Select the timeline clip/);
  });
  it("lets a still fill a clip of any length", () => {
    const { plan } = planReplaceEdit(base, { ...request, media: still });
    const out = find(apply(base, plan.edits), "b");
    expect(out).toMatchObject({ mediaId: "still", duration: 6, inPoint: 0, outPoint: 6 });
  });
  it("refuses to leave a restricted subclip window", () => {
    const sub = { ...src, subclip: { sourceMediaId: "src", inPoint: 4, outPoint: 8, restrictTrims: true } } as unknown as MediaItem;
    expect(() => planReplaceEdit(base, { ...request, media: sub, sourceIn: 4 })).toThrow(/restricted/);
  });
});

describe("findReplaceTarget", () => {
  it("prefers the selection, else the topmost clip under the playhead", () => {
    expect(findReplaceTarget(base, { media: src, selectedClipIds: ["c"], playhead: 5 })?.id).toBe("c");
    expect(findReplaceTarget(base, { media: src, selectedClipIds: [], playhead: 5 })?.id).toBe("b");
    expect(findReplaceTarget(base, { media: src, selectedClipIds: [], playhead: 5, targetedTrackIds: ["broll"] })?.id).toBe("c");
    expect(findReplaceTarget(base, { media: src, selectedClipIds: [], playhead: 11 })).toBeNull();
  });
  it("audio sources look at audio tracks", () => {
    expect(findReplaceTarget(base, { media: music, selectedClipIds: [], playhead: 5 })?.id).toBe("snd");
  });
});
