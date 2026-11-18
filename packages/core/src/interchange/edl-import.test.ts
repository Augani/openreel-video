import { describe, expect, it } from "vitest";
import type { MediaItem } from "../types/project";
import { detectInterchangeFormat, importTimeline } from "./index";
import { serializeEdl } from "./edl";
import { looksLikeEdl, matchReelItems, parseEdl } from "./edl-import";

const EDL = `TITLE: MY CUT
FCM: NON-DROP FRAME

001  A001C003 V     C        01:02:10:00 01:02:14:00 01:00:00:00 01:00:04:00
* FROM CLIP NAME: A001C003_interview.mov
002  A001C003 V     C        01:02:20:00 01:02:20:00 01:00:04:00 01:00:04:00
002  B002C001 V     D    012 01:10:00:00 01:10:03:00 01:00:04:00 01:00:07:00
* TO CLIP NAME: B002C001_broll.mov
003  B002C001 V     C        01:10:10:00 01:10:12:00 01:00:07:00 01:00:09:00
M2   B002C001 012.0                01:10:10:00
004  A001C003 A     C        01:02:10:00 01:02:14:00 01:00:00:00 01:00:04:00
* LOC: 01:00:02:00 RED Beat one
`;

const media = (id: string, name: string, startTimecode: number, duration: number): MediaItem =>
  ({
    id,
    name,
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: { duration, width: 1920, height: 1080, frameRate: 24, codec: "", sampleRate: 48000, channels: 2, fileSize: 1, startTimecode },
    thumbnailUrl: null,
    waveformData: null,
  }) as MediaItem;

describe("EDL import", () => {
  it("detects an EDL and nothing else", () => {
    expect(looksLikeEdl(EDL)).toBe(true);
    expect(detectInterchangeFormat(EDL)).toBe("edl");
    expect(looksLikeEdl("<xmeml></xmeml>")).toBe(false);
  });

  it("parses events, names, dissolves, speed changes and locators", () => {
    const { sequence, report } = parseEdl(EDL, { frameRate: 24 });
    expect(sequence.name).toBe("MY CUT");
    expect(sequence.startTimecode).toBe("01:00:00:00");
    const clips = sequence.tracks[0].clips;
    expect(clips).toHaveLength(3);
    expect(clips[0]).toMatchObject({ name: "A001C003_interview.mov", startFrame: 0, endFrame: 96, mediaKey: "A001C003" });
    expect(clips[0].edl).toEqual({ reel: "A001C003", sourceIn: "01:02:10:00", sourceOut: "01:02:14:00", event: 1 });
    expect(clips[1]).toMatchObject({ startFrame: 96, endFrame: 168, name: "B002C001_broll.mov" });
    expect(clips[2].speed).toBeCloseTo(0.5);
    expect(sequence.tracks[0].transitions).toEqual([{ kind: "dissolve", startFrame: 96, endFrame: 108, alignment: "start" }]);
    expect(sequence.markers).toEqual([{ frame: 48, name: "Beat one" }]);
    expect(report.warnings.join(" ")).toMatch(/audio-only/);
  });

  it("without media, in-points rebase to the reel's first source timecode", () => {
    const { sequence } = parseEdl(EDL, { frameRate: 24 });
    const first = sequence.tracks[0].clips[0];
    expect(first.inSec).toBe(0);
    expect(first.outSec).toBeCloseTo(4);
  });

  it("relinks by reel and subtracts the file's start timecode", () => {
    const start = 1 * 3600 + 2 * 60 + 0; // 01:02:00:00
    const items = [media("m1", "A001C003_interview.mov", start, 120), media("m2", "B002C001_broll.mov", 3600 + 600, 60)];
    expect(matchReelItems("A001C003", items).map((i) => i.id)).toEqual(["m1"]);
    const result = importTimeline(EDL, { mediaItems: items, frameRate: 24, makeId: (() => { let n = 0; return () => String(++n); })() });
    expect(result.format).toBe("edl");
    expect(result.unmatched).toEqual([]);
    expect(result.newMedia).toEqual([]);
    const clips = result.tracks.flatMap((t) => t.clips);
    expect(clips).toHaveLength(3);
    expect(clips[0].mediaId).toBe("m1");
    expect(clips[0].inPoint).toBeCloseTo(10);
    expect(clips[0].outPoint).toBeCloseTo(14);
    expect(clips[1].mediaId).toBe("m2");
    expect(clips[1].inPoint).toBeCloseTo(0);
    expect(clips[0].metadata?.edl).toMatchObject({ reel: "A001C003", sourceIn: "01:02:10:00" });
    expect(result.settings.frameRate).toBe(24);
  });

  it("picks between files sharing a reel name by source timecode", () => {
    const items = [media("a", "A001C003_a.mov", 0, 60), media("b", "A001C003_b.mov", 3600 + 2 * 60, 120)];
    const { sequence } = parseEdl(EDL, { frameRate: 24, mediaItems: items });
    expect(sequence.media.find((m) => m.key === "A001C003")?.name).toBe("A001C003_b.mov");
  });

  it("links the clip to the item chosen by source timecode, even when two items share a file name", () => {
    const items = [media("wrong", "A001C003.mov", 0, 60), media("right", "A001C003.mov", 3600 + 2 * 60, 120)];
    const result = importTimeline(EDL, { mediaItems: items, frameRate: 24, makeId: (() => { let n = 0; return () => String(++n); })() });
    const first = result.tracks.flatMap((t) => t.clips).find((c) => c.metadata?.edl && (c.metadata.edl as { reel: string }).reel === "A001C003")!;
    expect(first.mediaId).toBe("right");
    expect(first.inPoint).toBeCloseTo(10);
  });

  it("round-trips through serializeEdl keeping reels, source timecodes and record positions", () => {
    const { sequence } = parseEdl(EDL, { frameRate: 24 });
    const text = serializeEdl(sequence, 0);
    const again = parseEdl(text, { frameRate: 24 }).sequence.tracks[0].clips;
    expect(again.map((c) => c.edl?.reel)).toEqual(["A001C003", "B002C001", "B002C001"]);
    expect(again.map((c) => [c.startFrame, c.endFrame])).toEqual(sequence.tracks[0].clips.map((c) => [c.startFrame, c.endFrame]));
    expect(again[0].edl?.sourceIn).toBe("01:02:10:00");
  });

  it("offline reels become placeholders that remember their start timecode", () => {
    const result = importTimeline(EDL, { mediaItems: [], frameRate: 24 });
    expect(result.newMedia.map((m) => m.name).sort()).toEqual(["A001C003", "B002C001"].sort());
    expect(result.newMedia.every((m) => m.isPlaceholder && (m.metadata.startTimecode ?? 0) > 0)).toBe(true);
    expect(result.unmatched).toHaveLength(2);
  });

  it("rejects an EDL with no video events", () => {
    expect(() => parseEdl("TITLE: X\nFCM: NON-DROP FRAME\n001  AX V C 00:00:00:00 00:00:01:00 01:00:00:00 01:00:01:00\n".replace(" V ", " A "))).toThrow(/no video events/);
  });
});
