import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { MediaItem, Project } from "../types/project";
import {
  createProxyRef,
  effectiveIngestPreset,
  itemNeedsIngestProxy,
  matchProxyFiles,
  proxyDisplayState,
  proxyExportReport,
  proxyMatchKey,
  proxyScaleFactor,
  validateProxy,
} from "./proxy-workflow";
import { ProjectSerializer } from "../storage/project-serializer";

function media(id: string, over: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: { duration: 10, width: 3840, height: 2160, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1000 },
    thumbnailUrl: null,
    waveformData: null,
    ...over,
  };
}
const project = (items: MediaItem[]): Project =>
  ({
    id: "p",
    name: "P",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items },
    timeline: { duration: 0, tracks: [], subtitles: [], markers: [] },
  }) as unknown as Project;
const act = (params: Record<string, unknown>): Action => ({ type: "media/organize", id: `a-${Math.random()}`, timestamp: 0, params });
const ref = () =>
  createProxyRef({ storage: "idb", path: "proxy:a", probe: { duration: 10, width: 960, height: 540, frameRate: 30 }, fileSize: 500, source: "generated", preset: "low", now: 1 });

describe("proxy validation", () => {
  const full = media("a").metadata;
  it("accepts a matching proxy", () => {
    expect(validateProxy(full, { duration: 10.05, width: 960, height: 540, frameRate: 29.97 })).toEqual([]);
  });
  it("reports duration, frame rate and aspect mismatches", () => {
    const codes = validateProxy(full, { duration: 14, width: 800, height: 800, frameRate: 24 }).map((i) => i.code);
    expect(codes).toEqual(["duration", "frame-rate", "aspect"]);
  });
  it("rejects a file without video", () => {
    expect(validateProxy(full, { duration: 10, width: 0, height: 0, frameRate: 0 })[0].code).toBe("no-video");
  });
  it("scales from proxy to full pixels", () => {
    expect(proxyScaleFactor(full, { width: 960, height: 540 })).toBe(4);
    expect(proxyScaleFactor(full, { width: 0, height: 0 })).toBe(1);
  });
});

describe("proxy file matching", () => {
  it("normalises extension, case and proxy suffixes", () => {
    expect(proxyMatchKey("Interview_A_Proxy.MOV")).toBe("interview_a");
    expect(proxyMatchKey("clip-proxy.mp4")).toBe("clip");
    expect(proxyMatchKey("C:\\media\\Take 1.mp4")).toBe("take 1");
  });
  it("matches by name and reports leftovers and ambiguity", () => {
    const items = [media("a", { name: "Interview.mp4" }), media("b", { name: "Broll.mp4" }), media("c", { name: "Twin.mp4" }), media("d", { name: "Lonely.mp4" })];
    const files = [{ name: "interview_proxy.mp4" }, { name: "BROLL.mov" }, { name: "twin.mp4" }, { name: "twin_proxy.mp4" }, { name: "stray.mp4" }];
    const result = matchProxyFiles(items, files);
    expect(result.matches.map((m) => [m.mediaId, m.file.name])).toEqual([["a", "interview_proxy.mp4"], ["b", "BROLL.mov"]]);
    expect(result.ambiguousMediaIds).toEqual(["c"]);
    expect(result.unmatchedMediaIds).toEqual(["d"]);
    expect(result.unmatchedFiles.map((f) => f.name)).toEqual(["twin.mp4", "twin_proxy.mp4", "stray.mp4"]);
  });
});

describe("ingest presets and states", () => {
  it("per-import choice wins over the project default", () => {
    const p = project([]);
    expect(effectiveIngestPreset(p)).toBe("none");
    expect(effectiveIngestPreset({ mediaLibrary: { items: [], ingestPreset: "proxies" } })).toBe("proxies");
    expect(effectiveIngestPreset({ mediaLibrary: { items: [], ingestPreset: "proxies" } }, "none")).toBe("none");
  });
  it("only real, proxy-less video needs ingest", () => {
    expect(itemNeedsIngestProxy(media("a"))).toBe(true);
    expect(itemNeedsIngestProxy(media("a", { proxy: ref() }))).toBe(false);
    expect(itemNeedsIngestProxy(media("a", { type: "audio" }))).toBe(false);
    expect(itemNeedsIngestProxy(media("a", { isPlaceholder: true }))).toBe(false);
  });
  it("derives the project-panel state, missing full-res first", () => {
    const item = media("a", { proxy: ref() });
    expect(proxyDisplayState(item, { fullAvailable: true, proxyAvailable: true })).toBe("ready");
    expect(proxyDisplayState(item, { fullAvailable: true, proxyAvailable: false })).toBe("missing-proxy");
    expect(proxyDisplayState(item, { fullAvailable: false, proxyAvailable: true })).toBe("missing-full");
    expect(proxyDisplayState(media("a"), { fullAvailable: true, proxyAvailable: false, job: "encoding" })).toBe("building");
    expect(proxyDisplayState(media("a"), { fullAvailable: true, proxyAvailable: false, job: "error" })).toBe("failed");
    expect(proxyDisplayState(media("a"), { fullAvailable: true, proxyAvailable: false })).toBe("none");
  });
  it("states that exports use full-resolution media", () => {
    const report = proxyExportReport(project([media("a", { proxy: ref() }), media("b")]), new Set(["a"]));
    expect(report).toMatchObject({ source: "full-resolution", proxiedMedia: 1, usedProxy: false });
    expect(report.message).toContain("full-resolution");
    expect(proxyExportReport(project([media("b")])).proxiedMedia).toBe(0);
  });
});

describe("media/organize proxy patches", () => {
  it("attaches, detaches and changes the ingest preset as one undo step each", async () => {
    const p = project([media("a")]);
    const executor = new ActionExecutor();
    expect((await executor.execute(act({ label: "Attach proxy", itemPatches: { a: { proxy: ref() } } }), p)).success).toBe(true);
    expect(p.mediaLibrary.items[0].proxy?.width).toBe(960);
    expect((await executor.execute(act({ ingestPreset: "proxies" }), p)).success).toBe(true);
    expect(p.mediaLibrary.ingestPreset).toBe("proxies");
    await executor.undo(p);
    expect(p.mediaLibrary.ingestPreset).toBeUndefined();
    expect(p.mediaLibrary.items[0].proxy).toBeDefined();
    await executor.undo(p);
    expect(p.mediaLibrary.items[0].proxy).toBeUndefined();
    await executor.redo(p);
    expect(p.mediaLibrary.items[0].proxy).toBeDefined();
    expect((await executor.execute(act({ itemPatches: { a: { proxy: null } } }), p)).success).toBe(true);
    expect(p.mediaLibrary.items[0].proxy).toBeUndefined();
    await executor.undo(p);
    expect(p.mediaLibrary.items[0].proxy?.path).toBe("proxy:a");
  });
  it("rejects a bad preset and a proxy for unknown media", async () => {
    const p = project([media("a")]);
    const executor = new ActionExecutor();
    expect((await executor.execute(act({ ingestPreset: "bogus" }), p)).success).toBe(false);
    expect((await executor.execute(act({ itemPatches: { ghost: { proxy: ref() } } }), p)).success).toBe(false);
  });
  it("round-trips the proxy reference and ingest preset through the project file", () => {
    const serializer = new ProjectSerializer({} as never);
    const p = project([{ ...media("a", { proxy: ref() }), blob: new Blob(["x"]) }]);
    (p.mediaLibrary as { ingestPreset?: string }).ingestPreset = "proxies";
    const json = serializer.exportToJson(p);
    const loaded = serializer.importFromJson(json);
    expect(loaded.mediaLibrary.ingestPreset).toBe("proxies");
    expect(loaded.mediaLibrary.items[0].proxy).toEqual(ref());
  });
});

describe("review fixes", () => {
  const full = media("a").metadata;
  it("rejects a proxy whose duration is unreadable instead of letting NaN pass every comparison", () => {
    for (const duration of [NaN, Infinity, 0, -1])
      expect(validateProxy(full, { duration, width: 960, height: 540, frameRate: 30 })[0]?.code).toBe("duration");
  });
  it("never pairs a proxy file with a subclip", () => {
    const sub = media("clip", { subclip: { parentId: "a", inPoint: 0, outPoint: 1 } as MediaItem["subclip"] });
    const result = matchProxyFiles([sub, media("a")], [{ name: "clip_proxy.mp4" }, { name: "a_proxy.mp4" }]);
    expect(result.matches.map((m) => m.mediaId)).toEqual(["a"]);
    expect(result.unmatchedFiles.map((f) => f.name)).toEqual(["clip_proxy.mp4"]);
  });
  it("export report counts only proxied media the timelines use, nests included", () => {
    const p = project([media("a", { proxy: ref() }), media("b", { proxy: ref() }), media("c", { proxy: ref() })]);
    const clip = (mediaId: string) => ({ mediaId });
    const tl = (ids: string[]) => ({ duration: 0, tracks: [{ clips: ids.map(clip) }], subtitles: [], markers: [] });
    const withUse = { ...p, timeline: tl(["a"]), sequences: [{ id: "s", timeline: tl(["b"]) }] } as unknown as Project;
    expect(proxyExportReport(withUse).proxiedMedia).toBe(2);
    expect(proxyExportReport({ ...p, timeline: tl([]) } as unknown as Project).message).toBe("Exported from full-resolution media.");
  });
});
