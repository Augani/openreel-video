import { describe, expect, it } from "vitest";
import { timelineRows } from "./rows";

const track = (id: string, type: string, clips: unknown[] = [], extra: Record<string, unknown> = {}) => ({ id, type, clips, hidden: false, ...extra });
const clip = (id: string, mediaId: string, startTime: number, duration: number) => ({ id, mediaId, startTime, duration });

describe("timelineRows", () => {
  it("orders video, text, audio and maps media names and thumbnails", () => {
    const rows = timelineRows({
      mediaLibrary: { items: [{ id: "m1", name: "talk.mp4", thumbnailUrl: "t.jpg" }, { id: "a1", name: "song.mp3", thumbnailUrl: null }] },
      timeline: { tracks: [
        track("aud", "audio", [clip("ca", "a1", 0, 10)]),
        track("cap", "video", [], { role: "captions" }),
        track("vid", "video", [clip("c2", "m1", 5, 3), clip("c1", "m1", 0, 5)]),
        track("empty", "video"),
        track("gone", "video", [clip("x", "m1", 0, 1)], { hidden: true }),
      ] },
      textClips: [{ id: "t1", trackId: "cap", startTime: 1, duration: 2, text: "مرحبا" }],
    } as never);
    expect(rows.map((r) => [r.trackId, r.kind])).toEqual([["vid", "video"], ["cap", "text"], ["aud", "audio"]]);
    expect(rows[0].clips.map((c) => [c.id, c.start, c.thumb])).toEqual([["c1", 0, "t.jpg"], ["c2", 5, "t.jpg"]]);
    expect(rows[1].clips[0]).toMatchObject({ id: "t1", label: "مرحبا", selection: "text-clip" });
    expect(rows[2].clips[0]).toMatchObject({ label: "song.mp3", selection: "clip" });
  });
});
