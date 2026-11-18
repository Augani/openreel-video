import { describe, expect, it } from "vitest";
import type { Clip, MediaItem, Track } from "@openreel/core";
import {
  buildWindowTimes,
  clipSourceTime,
  isSameSource,
  posterFrameIndex,
  PREVIEW_WINDOW_SECONDS,
  previewSourceKey,
  selectPreviewSource,
  type PreviewSource,
} from "./source-selection";

const media = (id: string, type: MediaItem["type"] = "video", extra: Partial<MediaItem> = {}): MediaItem =>
  ({ id, name: id, type, blob: null, thumbnailUrl: null, metadata: { duration: 60 }, ...extra }) as unknown as MediaItem;

const clip = (id: string, mediaId: string, startTime: number, duration: number, extra: Partial<Clip> = {}): Clip =>
  ({ id, mediaId, trackId: "t", startTime, duration, inPoint: 0, outPoint: duration, ...extra }) as unknown as Clip;

const track = (id: string, clips: Clip[], extra: Partial<Track> = {}): Track =>
  ({ id, type: "video", clips, hidden: false, locked: false, ...extra }) as unknown as Track;

describe("selectPreviewSource", () => {
  const items = [media("a"), media("b"), media("still", "image"), media("song", "audio")];

  it("prefers the selected clip when the playhead is inside it", () => {
    const tracks = [
      track("v2", [clip("top", "a", 0, 10)]),
      track("v1", [clip("sel", "b", 0, 10)]),
    ];
    const source = selectPreviewSource({ tracks, media: items, selectedClipIds: ["sel"], playhead: 4 });
    expect(source?.clipId).toBe("sel");
    expect(source?.origin).toBe("selected");
  });

  it("falls back to the topmost visible video clip at the playhead (lowest track index is on top)", () => {
    const tracks = [
      track("v3", [clip("hiddenTop", "a", 0, 10)], { hidden: true }),
      track("v2", [clip("top", "a", 0, 10)]),
      track("v1", [clip("bottom", "b", 0, 10)]),
    ];
    const source = selectPreviewSource({ tracks, media: items, selectedClipIds: [], playhead: 3 });
    expect(source?.clipId).toBe("top");
    expect(source?.origin).toBe("playhead");
  });

  it("ignores a selected clip the playhead is outside of", () => {
    const tracks = [track("v1", [clip("sel", "b", 20, 5), clip("under", "a", 0, 10)])];
    const source = selectPreviewSource({ tracks, media: items, selectedClipIds: ["sel"], playhead: 3 });
    expect(source?.clipId).toBe("under");
  });

  it("prefers video over an image on a higher track", () => {
    const tracks = [track("v2", [clip("img", "still", 0, 10)]), track("v1", [clip("vid", "a", 0, 10)])];
    expect(selectPreviewSource({ tracks, media: items, selectedClipIds: [], playhead: 1 })?.clipId).toBe("vid");
  });

  it("uses the nearest video clip when the playhead is in a gap", () => {
    const tracks = [track("v1", [clip("early", "a", 0, 2), clip("late", "b", 30, 5)])];
    const near = selectPreviewSource({ tracks, media: items, selectedClipIds: [], playhead: 5 });
    expect(near?.clipId).toBe("early");
    expect(near?.origin).toBe("nearest");
    // Frame is clamped to the clip: the end of "early", not the playhead time.
    expect(near?.posterSourceTime).toBeLessThanOrEqual(2);
    expect(selectPreviewSource({ tracks, media: items, selectedClipIds: [], playhead: 25 })?.clipId).toBe("late");
  });

  it("returns null with no visual clips (audio only, text, hidden tracks) so the sample scene is used", () => {
    const audioOnly = [track("a1", [clip("song", "song", 0, 10)], { type: "audio" })];
    expect(selectPreviewSource({ tracks: audioOnly, media: items, selectedClipIds: [], playhead: 1 })).toBeNull();
    expect(selectPreviewSource({ tracks: [], media: [], selectedClipIds: [], playhead: 0 })).toBeNull();
    const hidden = [track("v1", [clip("x", "a", 0, 5)], { hidden: true })];
    expect(selectPreviewSource({ tracks: hidden, media: items, selectedClipIds: [], playhead: 1 })).toBeNull();
  });

  it("maps playhead to source time through in point and speed", () => {
    const sped = clip("fast", "a", 10, 8, { inPoint: 5, speed: 2 });
    expect(clipSourceTime(sped, 12)).toBe(9);
    const source = selectPreviewSource({ tracks: [track("v1", [sped])], media: items, selectedClipIds: [], playhead: 12 });
    expect(source?.posterSourceTime).toBe(9);
    expect(source?.windowStart).toBe(9);
  });

  it("windows playhead..+2 s and slides back so the loop stays a full window near the clip end", () => {
    const tracks = [track("v1", [clip("c", "a", 0, 10)])];
    const mid = selectPreviewSource({ tracks, media: items, selectedClipIds: [], playhead: 4 });
    expect(mid).toMatchObject({ windowStart: 4, windowSeconds: 2, posterSourceTime: 4 });
    const tail = selectPreviewSource({ tracks, media: items, selectedClipIds: [], playhead: 9.5 });
    expect(tail).toMatchObject({ windowStart: 8, windowSeconds: 2, posterSourceTime: 9.5 });
    const short = selectPreviewSource({ tracks: [track("v1", [clip("s", "a", 0, 0.8)])], media: items, selectedClipIds: [], playhead: 0.2 });
    expect(short?.windowSeconds).toBeCloseTo(0.8);
    expect(short?.windowStart).toBe(0);
  });

  it("treats image clips as a single still", () => {
    const source = selectPreviewSource({ tracks: [track("v1", [clip("i", "still", 0, 5)])], media: items, selectedClipIds: [], playhead: 1 });
    expect(source).toMatchObject({ mediaType: "image", windowSeconds: 0 });
    expect(buildWindowTimes(source as PreviewSource)).toHaveLength(1);
  });
});

describe("window times", () => {
  const source: PreviewSource = {
    clipId: "c", mediaId: "m", mediaType: "video", origin: "playhead",
    posterSourceTime: 4.5, windowStart: 4, windowSeconds: 2,
  };

  it("makes 24 frames at 12 fps inside the window", () => {
    const times = buildWindowTimes(source);
    expect(times).toHaveLength(24);
    expect(times[0]).toBe(4);
    expect(times[1]).toBeCloseTo(4 + 1 / 12);
    expect(times[23]).toBeLessThan(6);
  });

  it("finds the poster frame nearest the playhead", () => {
    const times = buildWindowTimes(source);
    expect(posterFrameIndex(source, times)).toBe(6);
  });
});

describe("source identity and retargeting", () => {
  const base: PreviewSource = {
    clipId: "c", mediaId: "m", mediaType: "video", origin: "playhead",
    posterSourceTime: 4, windowStart: 4, windowSeconds: 2,
  };

  it("keeps the window for small playhead moves inside the same clip", () => {
    expect(isSameSource(base, { ...base, posterSourceTime: 4.3, windowStart: 4.3 })).toBe(true);
  });

  it("retargets for a far move, a different clip or different media", () => {
    expect(isSameSource(base, { ...base, posterSourceTime: 5, windowStart: 5 })).toBe(false);
    expect(isSameSource(base, { ...base, clipId: "d" })).toBe(false);
    expect(isSameSource(base, { ...base, mediaId: "n" })).toBe(false);
    expect(isSameSource(base, null)).toBe(false);
    expect(isSameSource(null, null)).toBe(true);
  });

  it("keys the cache by media, clip and window start", () => {
    expect(previewSourceKey(base)).toBe("m:c:4000");
    expect(previewSourceKey(null)).toBe("sample");
    expect(previewSourceKey({ ...base, windowStart: 5 })).not.toBe(previewSourceKey(base));
  });
});

describe("transition incoming shot (partner)", () => {
  const items = [media("a"), media("b"), media("c"), media("still", "image")];
  const base = { media: items, selectedClipIds: [] as string[] };

  it("is absent with a single clip (the card blends towards the sample scene)", () => {
    const source = selectPreviewSource({ ...base, tracks: [track("v1", [clip("one", "a", 0, 10)])], playhead: 2 });
    expect(source?.partner ?? null).toBeNull();
  });

  it("is the first frame of the next clip on the same track", () => {
    const tracks = [track("v1", [clip("one", "a", 0, 10), clip("two", "b", 10, 5, { inPoint: 3 }), clip("three", "c", 15, 5)])];
    const source = selectPreviewSource({ ...base, tracks, playhead: 2 });
    expect(source?.partner).toEqual({ mediaId: "b", mediaType: "video", time: 3, seconds: 2 });
  });

  it("carries how many seconds of the next clip play on hover: the 2 s window, less for a short clip", () => {
    const long = selectPreviewSource({
      ...base,
      tracks: [track("v1", [clip("one", "a", 0, 10), clip("two", "b", 10, 5)])],
      playhead: 2,
    });
    expect(long?.partner?.seconds).toBe(PREVIEW_WINDOW_SECONDS);
    const short = selectPreviewSource({
      ...base,
      tracks: [track("v1", [clip("one", "a", 0, 10), clip("two", "b", 10, 0.75, { inPoint: 1 })])],
      playhead: 2,
    });
    expect(short?.partner?.seconds).toBeCloseTo(0.75, 5);
  });

  it("falls back to the previous clip when the playhead clip is last, and to other tracks", () => {
    const last = selectPreviewSource({
      ...base,
      tracks: [track("v1", [clip("one", "a", 0, 10), clip("two", "b", 10, 5)])],
      playhead: 12,
    });
    expect(last?.partner?.mediaId).toBe("a");
    const other = selectPreviewSource({
      ...base,
      tracks: [track("v2", [clip("over", "a", 0, 10)]), track("v1", [clip("under", "still", 0, 10)])],
      playhead: 2,
    });
    expect(other?.partner).toEqual({ mediaId: "still", mediaType: "image", time: 0, seconds: 0 });
  });

  it("prefers a different shot over another clip of the same media, and is part of the source identity", () => {
    const tracks = [track("v1", [clip("one", "a", 0, 10), clip("split", "a", 10, 5), clip("two", "b", 15, 5)])];
    const source = selectPreviewSource({ ...base, tracks, playhead: 2 })!;
    expect(source.partner?.mediaId).toBe("b");
    expect(previewSourceKey(source)).toContain(">b@");
    const withoutPartner: PreviewSource = { ...source, partner: null };
    expect(isSameSource(source, withoutPartner)).toBe(false);
    expect(previewSourceKey(source)).not.toBe(previewSourceKey(withoutPartner));
  });
});
