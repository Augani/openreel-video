import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { MediaItem, Project } from "../types/project";
import {
  effectiveFrameRate,
  interpretationSpeed,
  interpretedDisplaySize,
  interpretedDuration,
  normalizeInterpretation,
  validateInterpretation,
} from "./interpretation";

const item = (): MediaItem =>
  ({
    id: "a",
    name: "a.mp4",
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: { duration: 10, width: 720, height: 480, frameRate: 30, codec: "avc1", sampleRate: 48000, channels: 2, fileSize: 1000 },
    thumbnailUrl: null,
    waveformData: null,
  }) as MediaItem;
const project = (): Project =>
  ({
    id: "p",
    name: "P",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 24, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [item()] },
    timeline: {
      duration: 0,
      tracks: [{ id: "t1", type: "video", name: "V1", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false }],
      subtitles: [],
      markers: [],
    },
  }) as unknown as Project;
const act = (type: string, params: Record<string, unknown>): Action =>
  ({ type, id: `a-${Math.random()}`, timestamp: 0, params }) as Action;

describe("interpretation helpers", () => {
  it("conforms duration to the interpreted rate", () => {
    const m = { ...item(), interpretation: { frameRate: 24 } };
    expect(effectiveFrameRate(m)).toBe(24);
    expect(interpretationSpeed(m)).toBeCloseTo(0.8);
    expect(interpretedDuration(m)).toBeCloseTo(12.5);
    expect(interpretedDuration(item())).toBe(10);
  });
  it("stretches width by the pixel aspect ratio", () => {
    expect(interpretedDisplaySize({ ...item(), interpretation: { pixelAspectRatio: 40 / 33 } })).toEqual({ width: 872, height: 480 });
    expect(interpretedDisplaySize(item())).toEqual({ width: 720, height: 480 });
  });
  it("validates and normalizes", () => {
    expect(validateInterpretation({ frameRate: 0 })).toMatch(/frame rate/);
    expect(validateInterpretation({ pixelAspectRatio: 9 })).toMatch(/aspect/);
    expect(validateInterpretation({ frameRate: 24, fieldOrder: "upper" })).toBeNull();
    expect(normalizeInterpretation({ frameRate: 30, pixelAspectRatio: 1, fieldOrder: "progressive" }, { frameRate: 30 })).toBeUndefined();
  });
});

describe("Interpret footage (rate, PAR, fields) action", () => {
  it("sets, undoes and redoes; clearing removes it", async () => {
    const p = project();
    const ex = new ActionExecutor();
    const r = await ex.execute(act("media/organize", { itemPatches: { a: { interpretation: { frameRate: 24, fieldOrder: "lower" } } } }), p);
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(p.mediaLibrary.items[0].interpretation).toEqual({ frameRate: 24, fieldOrder: "lower" });
    await ex.undo(p);
    expect(p.mediaLibrary.items[0].interpretation).toBeUndefined();
    await ex.redo(p);
    expect(p.mediaLibrary.items[0].interpretation?.frameRate).toBe(24);
    await ex.execute(act("media/organize", { itemPatches: { a: { interpretation: null } } }), p);
    expect("interpretation" in p.mediaLibrary.items[0]).toBe(false);
  });

  it("rejects out-of-range values", async () => {
    const r = await new ActionExecutor().execute(act("media/organize", { itemPatches: { a: { interpretation: { frameRate: 999 } } } }), project());
    expect(r.success).toBe(false);
  });

  it("places clips with the conformed duration and speed", async () => {
    const p = project();
    const ex = new ActionExecutor();
    await ex.execute(act("media/organize", { itemPatches: { a: { interpretation: { frameRate: 24 } } } }), p);
    const r = await ex.execute(act("clip/add", { trackId: "t1", mediaId: "a", startTime: 0 }), p);
    expect(r.success, JSON.stringify(r)).toBe(true);
    const clip = p.timeline.tracks[0].clips[0];
    expect(clip.speed).toBeCloseTo(0.8);
    expect(clip.duration).toBeCloseTo(12.5);
    expect(clip.outPoint).toBe(10);
  });

  it("retimes clips already on the timeline in the same undo step and ripples later clips", async () => {
    const p = project();
    const ex = new ActionExecutor();
    await ex.execute(act("clip/add", { trackId: "t1", mediaId: "a", startTime: 0, duration: 10 }), p);
    await ex.execute(act("clip/add", { trackId: "t1", mediaId: "a", startTime: 10, duration: 5, inPoint: 0, outPoint: 5 }), p);
    const before = structuredClone(p.timeline.tracks[0].clips);
    const r = await ex.execute(act("media/organize", { retimeClips: true, itemPatches: { a: { interpretation: { frameRate: 24 } } } }), p);
    expect(r.success, JSON.stringify(r)).toBe(true);
    const [c1, c2] = p.timeline.tracks[0].clips;
    expect(c1.speed).toBeCloseTo(0.8);
    expect(c1.duration).toBeCloseTo(12.5);
    expect(c2.speed).toBeCloseTo(0.8);
    expect(c2.duration).toBeCloseTo(6.25);
    expect(c2.startTime).toBeCloseTo(12.5);
    await ex.undo(p);
    expect(p.timeline.tracks[0].clips).toEqual(before);
    expect(p.mediaLibrary.items[0].interpretation).toBeUndefined();
    await ex.redo(p);
    expect(p.timeline.tracks[0].clips[0].duration).toBeCloseTo(12.5);
  });

  it("leaves clips alone without retimeClips and refuses a locked track", async () => {
    const p = project();
    const ex = new ActionExecutor();
    await ex.execute(act("clip/add", { trackId: "t1", mediaId: "a", startTime: 0, duration: 10 }), p);
    await ex.execute(act("media/organize", { itemPatches: { a: { interpretation: { frameRate: 24 } } } }), p);
    expect(p.timeline.tracks[0].clips[0].duration).toBe(10);
    (p.timeline.tracks[0] as { locked: boolean }).locked = true;
    const r = await ex.execute(act("media/organize", { retimeClips: true, itemPatches: { a: { interpretation: { frameRate: 25 } } } }), p);
    expect(r.success).toBe(false);
  });
});

describe("media items saved without metadata", () => {
  it("do not throw in the interpretation helpers (legacy or partial items)", async () => {
    const m = await import("./interpretation");
    const bare = { interpretation: undefined } as unknown as Pick<MediaItem, "metadata" | "interpretation">;
    expect(() => m.thumbnailsNeedRefresh(bare as MediaItem)).not.toThrow();
    expect(m.effectivePixelAspect(bare)).toBe(1);
    expect(m.interpretationSpeed(bare)).toBe(1);
    expect(m.interpretedDuration(bare)).toBe(0);
    expect(m.interpretedDisplaySize(bare)).toEqual({ width: 0, height: 0 });
  });
});
