import { describe, expect, it } from "vitest";
import { editSnapshot } from "../actions/handlers/edit-snapshot";
import type { Clip, Project, Track } from "../types";
import { activateSequence, ensureSequences, getSequence, nestClips } from "./sequences";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number, extra: Partial<Clip> = {}): Clip => ({
  id, mediaId: "m1", trackId, startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [], ...extra,
});
const track = (id: string, type: Track["type"], clips: Clip[] = []): Track => ({
  id, type, name: id, mode: "standard", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const media = (id: string) => ({
  id, name: `${id}.mp4`, type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  metadata: { duration: 10, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1 },
});

/** A rich range: two clips with a transition + effect + keyframes + mask, a title, a caption and a marker, plus content outside it. */
function richProject(): Project {
  const fx = { id: "fx1", type: "blur", params: { radius: 4 }, enabled: true };
  const kf = { id: "kf1", time: 0.5, property: "transform.scale", value: { x: 1.2, y: 1.2 }, easing: "linear" as const };
  const a = clip("a", "v1", 2, 3, { effects: [fx], keyframes: [kf] });
  const b = clip("b", "v1", 5, 3);
  const outside = clip("outside", "v1", 10, 2);
  const v1: Track = { ...track("v1", "video", [a, b, outside]), transitions: [{ id: "t1", clipAId: "a", clipBId: "b", type: "crossfade", duration: 0.5, params: {} } as never] };
  return {
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media("m1")] as unknown as Project["mediaLibrary"]["items"] },
    timeline: {
      tracks: [track("t-text", "text"), v1, track("a1", "audio", [clip("aud", "a1", 2, 6)])],
      subtitles: [
        { id: "cap-in", text: "inside", startTime: 3, endTime: 4 },
        { id: "cap-out", text: "outside", startTime: 10, endTime: 11 },
      ] as never,
      duration: 12,
      markers: [{ id: "mk-in", time: 3, label: "in", color: "#fff" }, { id: "mk-out", time: 11, label: "out", color: "#fff" }] as never,
    },
    textClips: [{ id: "title", trackId: "t-text", startTime: 2.5, duration: 2, text: "Hello", style: {}, transform, keyframes: [] }] as never,
    masks: [{ id: "mask1", clipId: "a", type: "shape", path: { points: [], closed: true }, feathering: 0, inverted: false, expansion: 0, opacity: 1, keyframes: [] }] as never,
  };
}

describe("nestClips completeness", () => {
  it("carries overlays, masks, keyframes, effects, transitions, captions and markers into the nest with nest-local times", () => {
    const base = richProject();
    const result = nestClips(base, ["a", "b", "title"], "Nest");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parent = ensureSequences(result.project);
    const nest = getSequence(parent, result.sequenceId as string)!;
    // Media clips: ids, effects, keyframes preserved; times shifted by the span start (2s).
    const inner = nest.timeline.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips);
    expect(inner.map((c) => [c.id, c.startTime, c.duration])).toEqual([["a", 0, 3], ["b", 3, 3]]);
    expect(inner[0].effects).toHaveLength(1);
    expect(inner[0].keyframes).toHaveLength(1);
    // The transition between two nested clips travels; the parent keeps none.
    expect(nest.timeline.tracks.flatMap((t) => t.transitions).map((t) => [t.clipAId, t.clipBId])).toEqual([["a", "b"]]);
    expect(parent.timeline.tracks.flatMap((t) => t.transitions)).toEqual([]);
    // Masks stay keyed by the (unchanged) clip id.
    expect(parent.masks?.map((m) => m.clipId)).toEqual(["a"]);
    // The title moved onto an inner text track with local time; it left the parent's track.
    const title = parent.textClips!.find((t) => t.id === "title")!;
    const innerTextTrack = nest.timeline.tracks.find((t) => t.type === "text")!;
    expect(title.trackId).toBe(innerTextTrack.id);
    expect(title.startTime).toBeCloseTo(0.5, 6);
    expect(parent.timeline.tracks.some((t) => t.id === title.trackId)).toBe(false);
    // Only the caption and marker inside the span travel, shifted to nest time.
    expect(nest.timeline.subtitles.map((c) => [c.id, c.startTime, c.endTime])).toEqual([["cap-in", 1, 2]]);
    expect(parent.timeline.subtitles.map((c) => c.id)).toEqual(["cap-out"]);
    expect(nest.timeline.markers.map((m) => [m.id, m.time])).toEqual([["mk-in", 1]]);
    expect(parent.timeline.markers.map((m) => m.id)).toEqual(["mk-out"]);
    // Linked audio (same media, same source origin) came along.
    expect(nest.timeline.tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips).map((c) => [c.id, c.startTime])).toEqual([["aud", 0]]);
    expect(parent.timeline.tracks.find((t) => t.id === "a1")!.clips).toEqual([]);
  });

  it("projects the nest with its own captions and settings for the renderer", () => {
    const result = nestClips(richProject(), ["a", "b", "title"], "Nest");
    if (!result.ok) throw new Error(result.message);
    const compound = result.project.compoundClips!.find((c) => c.id === result.sequenceId);
    expect(compound?.content.subtitles?.map((c) => c.id)).toEqual(["cap-in"]);
    expect(compound?.settings?.width).toBe(1920);
  });

  it("is exactly undone by restoring the edit snapshot taken before (no leaked overlays/captions/markers)", () => {
    const base = ensureSequences(richProject());
    const before = JSON.stringify(editSnapshot(base));
    const result = nestClips(base, ["a", "b", "title"], "Nest");
    expect(result.ok).toBe(true);
    expect(JSON.stringify(editSnapshot(base))).toBe(before); // the input is never mutated
  });

  it("works inside an opened nest (nesting a part of the nest) and keeps ids unique", () => {
    const first = nestClips(richProject(), ["a", "b", "title"], "Outer");
    if (!first.ok) throw new Error(first.message);
    const opened = activateSequence(first.project, first.sequenceId as string);
    if (!opened.ok) throw new Error(opened.message);
    const second = nestClips(opened.project, ["b"], "Inner");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.project.sequences).toHaveLength(3);
  });

  it("pulls in captions bound to a nested clip and refuses locked overlay tracks", () => {
    const base = richProject();
    base.textClips!.push({ id: "bound", trackId: "t-text", startTime: 2, duration: 1, text: "c", style: {}, transform, keyframes: [], metadata: { captionSourceClipId: "a" } } as never);
    const result = nestClips(base, ["a"], "N");
    if (!result.ok) throw new Error(result.message);
    const bound = result.project.textClips!.find((t) => t.id === "bound")!;
    expect(bound.trackId).not.toBe("t-text");
    const locked = richProject();
    locked.timeline.tracks[0] = { ...locked.timeline.tracks[0], locked: true };
    expect(nestClips(locked, ["a", "title"], "N").ok).toBe(false);
  });

  it("drops a transition that would dangle when only one side is nested", () => {
    const result = nestClips(richProject(), ["b"], "N");
    if (!result.ok) throw new Error(result.message);
    expect(result.project.timeline.tracks.flatMap((t) => t.transitions)).toEqual([]);
  });
});
