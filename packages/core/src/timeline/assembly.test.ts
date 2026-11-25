import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import type { MediaItem } from "../types/project";
import { applyTimelineToolEdits, validateTimelineToolEdits } from "../editing/timeline-tool-edit";
import { orderAssemblyMedia, planAutomateToSequence, DEFAULT_ASSEMBLY_OPTIONS, type AssemblyOptions } from "./assembly";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "x", trackId, startTime, duration, inPoint: 0, outPoint: duration, effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const track = (id: string, type: Track["type"], clips: Clip[] = [], name = id): Track => ({
  id, name, type, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const media = (id: string, name: string, type: MediaItem["type"], duration: number, extra: Partial<MediaItem> = {}): MediaItem => ({
  id, name, type, fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, codec: "h264", fileSize: 1, hasAudio: type !== "image" },
  ...extra,
});
const project = (tracks: Track[], items: MediaItem[] = []): Project => ({
  id: "p", name: "p", createdAt: 0, modifiedAt: 0,
  settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items },
  timeline: { tracks, subtitles: [], duration: 0, markers: [] },
} as unknown as Project);

let counter = 0;
const ids = () => `i${counter++}`;
const options = (extra: Partial<AssemblyOptions> = {}): AssemblyOptions => ({ ...DEFAULT_ASSEMBLY_OPTIONS, ...extra });

const A = media("a", "Clip 10.mp4", "video", 4, { importedAt: 300 });
const B = media("b", "clip 2.mp4", "video", 6, { importedAt: 100 });
const C = media("c", "Still.png", "image", 0, { importedAt: 200 });
const D = media("d", "Music.wav", "audio", 20, { importedAt: 50 });

function run(base: Project, items: MediaItem[], extra: Partial<AssemblyOptions> = {}) {
  counter = 0;
  const result = planAutomateToSequence(base, items, options(extra), ids);
  if (!result.ok) throw new Error(result.message);
  validateTimelineToolEdits(base, result.plan.edits);
  return { result, next: applyTimelineToolEdits(base, result.plan.edits) };
}
const clipsOn = (p: Project, id: string) => [...(p.timeline.tracks.find((t) => t.id === id)?.clips ?? [])].sort((x, y) => x.startTime - y.startTime);
const empty = () => project([track("v1", "video"), track("a1", "audio")], [A, B, C, D]);

describe("assembly ordering", () => {
  const all = [A, B, C, D];
  it("selection order follows the click order and drops unknown ids", () => {
    expect(orderAssemblyMedia(all, ["c", "a", "zzz", "b", "a"], "selection").map((m) => m.id)).toEqual(["c", "a", "b"]);
  });
  it("name order is natural (2 before 10) and case-insensitive", () => {
    expect(orderAssemblyMedia(all, ["a", "b", "c", "d"], "name").map((m) => m.id)).toEqual(["b", "a", "d", "c"]);
    expect(orderAssemblyMedia(all, ["a", "b"], "name").map((m) => m.id)).toEqual(["b", "a"]);
  });
  it("date order uses import time, then name", () => {
    expect(orderAssemblyMedia(all, ["a", "b", "c", "d"], "date").map((m) => m.id)).toEqual(["d", "b", "c", "a"]);
    const tie = [media("x", "B", "video", 1, { importedAt: 5 }), media("y", "A", "video", 1, { importedAt: 5 })];
    expect(orderAssemblyMedia(tie, ["x", "y"], "date").map((m) => m.id)).toEqual(["y", "x"]);
  });
  it("falls back to the file's modified time when there is no import time", () => {
    const old = media("o", "O", "video", 1, { sourceFile: { name: "O", size: 1, lastModified: 10 } });
    const recent = media("r", "R", "video", 1, { importedAt: 20 });
    expect(orderAssemblyMedia([recent, old], ["r", "o"], "date").map((m) => m.id)).toEqual(["o", "r"]);
  });
});

describe("planAutomateToSequence", () => {
  it("lays clips end to end from the playhead, picture and linked sound", () => {
    const { result, next } = run(empty(), [A, B], { at: 2 });
    const video = clipsOn(next, "v1");
    const audio = clipsOn(next, "a1");
    expect(video.map((c) => [c.startTime, c.duration])).toEqual([[2, 4], [6, 6]]);
    expect(audio.map((c) => [c.startTime, c.duration])).toEqual([[2, 4], [6, 6]]);
    expect(audio[0].metadata?.separatedFromClipId).toBe(video[0].id);
    expect(result.end).toBe(12);
    expect(result.placed).toEqual([A.name, B.name]);
  });

  it("gives a still image the still duration", () => {
    const { next } = run(empty(), [C, A], { stillDuration: 3 });
    const video = clipsOn(next, "v1");
    expect(video[0].duration).toBe(3);
    expect(video[1].startTime).toBe(3);
    expect(clipsOn(next, "a1")).toHaveLength(1);
  });

  it("applies the default transition between adjacent pictures only", () => {
    const { result, next } = run(empty(), [A, B, C], { videoTransition: true });
    const transitions = next.timeline.tracks.find((t) => t.id === "v1")!.transitions;
    expect(result.transitionCount).toBe(2);
    const video = clipsOn(next, "v1");
    expect(transitions.map((t) => [t.clipAId, t.clipBId])).toEqual([[video[0].id, video[1].id], [video[1].id, video[2].id]]);
    expect(transitions[0].type).toBe("crossfade");
    expect(transitions[0].duration).toBeLessThanOrEqual(2 * Math.min(video[0].duration, video[1].duration));
  });

  it("uses the project's default transition when one is set", () => {
    const base = { ...empty(), defaultTransition: { type: "dipToBlack", duration: 0.5, params: {} } } as unknown as Project;
    const { next } = run(base, [A, B], { videoTransition: true });
    const [t] = next.timeline.tracks.find((tr) => tr.id === "v1")!.transitions;
    expect(t.type).toBe("dipToBlack");
    expect(t.duration).toBe(0.5);
  });

  it("makes no transition across gaps, and offsets by the gap", () => {
    const { result, next } = run(empty(), [A, B], { videoTransition: true, audioTransition: true, gap: 1 });
    expect(result.transitionCount).toBe(0);
    expect(clipsOn(next, "v1").map((c) => c.startTime)).toEqual([0, 5]);
    expect(clipsOn(next, "a1").every((c) => !c.fade)).toBe(true);
  });

  it("adds an audio fade pair at touching sounds", () => {
    const { next } = run(empty(), [A, B], { audioTransition: true });
    const [first, second] = clipsOn(next, "a1");
    expect(first.fade?.fadeOut).toBeGreaterThan(0);
    expect(first.fade?.fadeIn).toBe(0);
    expect(second.fade?.fadeIn).toBe(first.fade?.fadeOut);
  });

  it("insert ripples what follows the playhead; overwrite replaces what it covers", () => {
    const existing = [track("v1", "video", [clip("old1", "v1", 0, 5), clip("old2", "v1", 5, 5)]), track("a1", "audio")];
    const inserted = run(project(existing, [A, B]), [A], { method: "insert", at: 5 }).next;
    expect(clipsOn(inserted, "v1").map((c) => [c.id === "old2" ? "old2" : c.id === "old1" ? "old1" : "new", c.startTime])).toEqual([["old1", 0], ["new", 5], ["old2", 9]]);
    const over = run(project(existing, [A, B]), [A], { method: "overwrite", at: 5 }).next;
    const v = clipsOn(over, "v1");
    expect(v.find((c) => c.id === "old2")).toBeUndefined();
    expect(v.map((c) => c.startTime)).toEqual([0, 5, 9].slice(0, v.length));
    expect(v.find((c) => c.startTime === 5)?.duration).toBe(4);
    expect(v.find((c) => c.startTime === 9)?.duration).toBe(1);
  });

  it("insert at the playhead splits a straddling clip and ripples the right half", () => {
    const existing = [track("v1", "video", [clip("old", "v1", 0, 10)]), track("a1", "audio")];
    const { next } = run(project(existing, [A]), [A], { method: "insert", at: 4 });
    expect(clipsOn(next, "v1").map((c) => [c.startTime, c.duration])).toEqual([[0, 4], [4, 4], [8, 6]]);
  });

  it("ignore audio mutes the pictures and places no sound; ignore video places only sound", () => {
    const noAudio = run(empty(), [A, D], { ignoreAudio: true });
    expect(clipsOn(noAudio.next, "a1")).toHaveLength(0);
    expect(clipsOn(noAudio.next, "v1")).toHaveLength(1);
    expect(clipsOn(noAudio.next, "v1")[0].volume).toBe(0);
    expect(noAudio.result.skipped).toEqual([D.name]);
    const noVideo = run(empty(), [A, C, D], { ignoreVideo: true });
    expect(clipsOn(noVideo.next, "v1")).toHaveLength(0);
    expect(clipsOn(noVideo.next, "a1").map((c) => [c.startTime, c.duration])).toEqual([[0, 4], [4, 20]]);
    expect(noVideo.result.skipped).toEqual([C.name]);
  });

  it("creates tracks when the project has none and refuses when both streams are ignored", () => {
    const { next } = run(project([], [A, D]), [A, D]);
    expect(next.timeline.tracks.map((t) => t.type).sort()).toEqual(["audio", "video"]);
    counter = 0;
    expect(planAutomateToSequence(empty(), [A], options({ ignoreAudio: true, ignoreVideo: true }), ids).ok).toBe(false);
    expect(planAutomateToSequence(empty(), [], options(), ids).ok).toBe(false);
  });
});
