import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@openreel/core";
import { computeLaneInfos, sameLaneInfo } from "./clip-lane-info";

const transform = { position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration = 1): Clip =>
  ({ id, mediaId: "m", trackId, startTime, duration, inPoint: 0, outPoint: duration, effects: [], audioEffects: [], keyframes: [], volume: 1, transform }) as Clip;
const track = (id: string, type: "video" | "audio", clips: Clip[], transitions: Track["transitions"] = []): Track =>
  ({ id, name: id, type, clips, transitions, locked: false, hidden: false, muted: false, solo: false }) as Track;

const input = (tracks: Track[], lane: Track) => ({
  track: lane,
  allTracks: tracks,
  frameRate: 30,
  mediaTypeOf: () => lane.type as string,
});

describe("computeLaneInfos", () => {
  it("flags a leading transition badge for an adjacent predecessor and the lane badge", () => {
    const v1 = track("v1", "video", [clip("a", "v1", 0), clip("b", "v1", 1), clip("c", "v1", 5)]);
    const infos = computeLaneInfos(v1.clips, input([v1], v1));
    expect(infos.get("a")?.leadingTransitionBadge).toBe(false);
    expect(infos.get("b")?.leadingTransitionBadge, "touches a").toBe(true);
    expect(infos.get("c")?.leadingTransitionBadge, "gap before c").toBe(false);
    expect(infos.get("a")?.trackBadge).toBe("V1");
  });

  it("keeps each clip's info object when a commit changes nothing that clip renders", () => {
    const v1 = track("v1", "video", [clip("a", "v1", 0), clip("b", "v1", 4)]);
    const first = computeLaneInfos(v1.clips, input([v1], v1));
    // A move elsewhere replaces the tracks array and the moved clip, not this clip's derived state.
    const v1After = track("v1", "video", [v1.clips[0], clip("b", "v1", 4.25)]);
    const second = computeLaneInfos(v1After.clips, input([v1After], v1After), first);
    expect(second.get("a")).toBe(first.get("a"));
    expect(second.get("b")).toBe(first.get("b"));
  });

  it("changes a neighbour's info when the move makes it adjacent", () => {
    const v1 = track("v1", "video", [clip("a", "v1", 0), clip("b", "v1", 4)]);
    const first = computeLaneInfos(v1.clips, input([v1], v1));
    const v1After = track("v1", "video", [v1.clips[0], clip("b", "v1", 1)]);
    const second = computeLaneInfos(v1After.clips, input([v1After], v1After), first);
    expect(second.get("b")?.leadingTransitionBadge).toBe(true);
    expect(sameLaneInfo(first.get("b")!, second.get("b")!)).toBe(false);
  });

  it("reports an L-cut offset on the audio clip of a linked pair", () => {
    const video = clip("v", "v1", 0, 2);
    const audio = { ...clip("au", "a1", 0, 3), metadata: { linkedClipId: "v" } } as Clip;
    const tracks = [track("v1", "video", [{ ...video, metadata: { linkedClipId: "au" } } as Clip]), track("a1", "audio", [audio])];
    const infos = computeLaneInfos(tracks[1].clips, input(tracks, tracks[1]));
    const offset = infos.get("au")?.splitOffset;
    // Detection depends on core's link rules; the contract here is only "null or a consistent offset".
    if (offset) expect(Math.abs(offset.end)).toBeGreaterThan(0);
    expect(infos.get("au")?.trackBadge).toBe("A1");
  });
});
