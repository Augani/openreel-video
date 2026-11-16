import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { MediaItem, Project } from "../types/project";
import {
  DEFAULT_SOURCE_COLOR,
  describeSourceColor,
  effectiveSourceColor,
  inputSpaceForItem,
  isHdrTransfer,
  needsInputTransform,
  parseSourceColor,
} from "./source-color";

describe("parseSourceColor", () => {
  it("reads WebCodecs spellings", () => {
    expect(parseSourceColor({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false })).toEqual({
      primaries: "bt2020",
      transfer: "pq",
      matrix: "bt2020-ncl",
      fullRange: false,
    });
    expect(parseSourceColor({ primaries: "bt2020", transfer: "hlg", matrix: "bt2020-ncl" })?.transfer).toBe("hlg");
  });

  it("reads ffmpeg spellings", () => {
    const space = parseSourceColor({ primaries: "bt2020", transfer: "smpte2084", matrix: "bt2020nc", fullRange: false });
    expect(space).toMatchObject({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl" });
    expect(parseSourceColor({ primaries: "bt2020", transfer: "arib-std-b67", matrix: "bt2020nc" })?.transfer).toBe("hlg");
    expect(parseSourceColor({ primaries: "smpte432", transfer: "iec61966-2-1" })).toMatchObject({ primaries: "p3", transfer: "srgb" });
  });

  it("returns null for a file with no tags and infers BT.2020 primaries from the matrix", () => {
    expect(parseSourceColor(null)).toBeNull();
    expect(parseSourceColor({})).toBeNull();
    expect(parseSourceColor({ primaries: null, transfer: null, matrix: null })).toBeNull();
    expect(parseSourceColor({ matrix: "bt2020-ncl" })?.primaries).toBe("bt2020");
  });

  it("recognises HDR and wide gamut, and plain SDR needs nothing", () => {
    expect(isHdrTransfer({ transfer: "pq" })).toBe(true);
    expect(needsInputTransform(DEFAULT_SOURCE_COLOR)).toBe(false);
    expect(needsInputTransform({ primaries: "bt2020", transfer: "bt709", matrix: "bt2020-ncl", fullRange: false })).toBe(true);
    expect(describeSourceColor({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false })).toBe("Rec.2020 / PQ / BT.2020nc / limited");
  });
});

describe("inputSpaceForItem", () => {
  const pq = { primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false } as const;
  it("leaves every SDR Rec.709 item alone (byte-identical)", () => {
    expect(inputSpaceForItem({ metadata: {} })).toBeNull();
    expect(inputSpaceForItem({ metadata: { sourceColor: DEFAULT_SOURCE_COLOR }, nativeSource: {} })).toBeNull();
    expect(inputSpaceForItem({ metadata: { sourceColor: DEFAULT_SOURCE_COLOR }, colorInterpretation: "rec709" })).toBeNull();
  });

  it("does not transform tagged HDR the browser already converted, but does on the native decode path", () => {
    expect(inputSpaceForItem({ metadata: { sourceColor: pq } })).toBeNull();
    expect(inputSpaceForItem({ metadata: { sourceColor: pq }, nativeSource: { path: "/a.mov" } })).toEqual(pq);
  });

  it("an override wins over the tags", () => {
    const item = { metadata: { sourceColor: pq }, colorInterpretation: "rec709" as const };
    expect(effectiveSourceColor(item)).toEqual(DEFAULT_SOURCE_COLOR);
    expect(inputSpaceForItem(item)).toBeNull();
    expect(inputSpaceForItem({ metadata: {}, colorInterpretation: "hlg" })?.transfer).toBe("hlg");
  });
});

describe("Interpret footage action", () => {
  const item = (): MediaItem =>
    ({
      id: "a",
      name: "a.mp4",
      type: "video",
      fileHandle: null,
      blob: null,
      metadata: { duration: 10, width: 1920, height: 1080, frameRate: 30, codec: "hevc", sampleRate: 48000, channels: 2, fileSize: 1000 },
      thumbnailUrl: null,
      waveformData: null,
    }) as MediaItem;
  const project = (): Project =>
    ({
      id: "p",
      name: "P",
      createdAt: 0,
      modifiedAt: 0,
      settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
      mediaLibrary: { items: [item()] },
      timeline: { duration: 0, tracks: [], subtitles: [], markers: [] },
    }) as unknown as Project;
  const act = (params: Record<string, unknown>): Action => ({ type: "media/organize", id: `a-${Math.random()}`, timestamp: 0, params });

  it("sets and clears the override as one undoable step each", async () => {
    const p = project();
    const executor = new ActionExecutor();
    expect((await executor.execute(act({ itemPatches: { a: { colorInterpretation: "hdr10-pq" } } }), p)).success).toBe(true);
    expect(p.mediaLibrary.items[0].colorInterpretation).toBe("hdr10-pq");
    expect((await executor.execute(act({ itemPatches: { a: { colorInterpretation: "rec2020" } } }), p)).success).toBe(true);
    expect(p.mediaLibrary.items[0].colorInterpretation).toBe("rec2020");
    await executor.undo(p);
    expect(p.mediaLibrary.items[0].colorInterpretation).toBe("hdr10-pq");
    await executor.undo(p);
    expect(p.mediaLibrary.items[0].colorInterpretation).toBeUndefined();
    await executor.redo(p);
    expect(p.mediaLibrary.items[0].colorInterpretation).toBe("hdr10-pq");
    expect((await executor.execute(act({ itemPatches: { a: { colorInterpretation: null } } }), p)).success).toBe(true);
    expect("colorInterpretation" in p.mediaLibrary.items[0]).toBe(false);
  });

  it("rejects an unknown interpretation", async () => {
    const result = await new ActionExecutor().execute(act({ itemPatches: { a: { colorInterpretation: "xyz" } } }), project());
    expect(result.success).toBe(false);
  });
});
