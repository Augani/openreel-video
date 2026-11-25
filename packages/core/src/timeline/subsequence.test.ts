import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { getCompoundClipId, makeSubsequence } from "./index";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "m", trackId, startTime, duration, inPoint: 0, outPoint: duration, effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const track = (id: string, clips: Clip[]): Track => ({ id, name: id, type: "video", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false });
const base = (): Project => ({
  id: "p", name: "p", createdAt: 0, modifiedAt: 0,
  settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [] },
  timeline: { tracks: [track("v1", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4), clip("c", "v1", 8, 4)])], subtitles: [], duration: 12, markers: [] },
} as unknown as Project);

describe("makeSubsequence", () => {
  it("nests the range in place, splitting clips at its edges", () => {
    const result = makeSubsequence(base(), { start: 2, end: 10 }, "Sub");
    if (!result.ok) throw new Error(result.message);
    const clips = result.project.timeline.tracks.flatMap((t) => t.clips).sort((x, y) => x.startTime - y.startTime);
    expect(clips.map((c) => [c.startTime, c.duration])).toEqual([[0, 2], [2, 8], [10, 2]]);
    const nest = clips[1];
    expect(getCompoundClipId(nest)).toBe(result.sequenceId);
    const inner = result.project.sequences?.find((s) => s.id === result.sequenceId);
    expect(inner?.name).toBe("Sub");
    expect(inner?.timeline.tracks.flatMap((t) => t.clips).map((c) => [c.startTime, c.duration])).toEqual([[0, 2], [2, 4], [6, 2]]);
  });
  it("refuses an empty range", () => {
    expect(makeSubsequence(base(), { start: 3, end: 3 }).ok).toBe(false);
    expect(makeSubsequence(base(), { start: 20, end: 30 }).ok).toBe(false);
  });
});
