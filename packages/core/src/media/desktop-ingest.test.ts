import { describe, expect, it } from "vitest";
import {
  desktopPreviewTwinName,
  desktopProxyDimensions,
  desktopProxyFileName,
  describeExportSource,
  formatProxyCounts,
  isDesktopIngestConfig,
  matchRelinkCandidates,
  scoreRelinkCandidate,
  summarizeProxyStates,
  uniqueCopyName,
  type RelinkCandidate,
  type RelinkTarget,
} from "./desktop-ingest";

const target = (over: Partial<RelinkTarget> = {}): RelinkTarget => ({
  id: "m1",
  type: "video",
  name: "A001_C002.MOV",
  duration: 12.5,
  frameRate: 29.97,
  size: 1000,
  ...over,
});
const file = (over: Partial<RelinkCandidate> = {}): RelinkCandidate => ({
  path: "/vol/a/A001_C002.mov",
  name: "A001_C002.mov",
  duration: 12.5,
  frameRate: 29.97,
  size: 1000,
  ...over,
});

describe("desktopProxyDimensions", () => {
  it("halves and quarters a 4K frame with even dimensions", () => {
    expect(desktopProxyDimensions(3840, 2160, "half")).toEqual({ width: 1920, height: 1080 });
    expect(desktopProxyDimensions(3840, 2160, "quarter")).toEqual({ width: 960, height: 540 });
  });
  it("fixes the height, never upscales, keeps the aspect", () => {
    expect(desktopProxyDimensions(3840, 2160, "720p")).toEqual({ width: 1280, height: 720 });
    expect(desktopProxyDimensions(1280, 720, "1080p")).toEqual({ width: 1280, height: 720 });
    expect(desktopProxyDimensions(2048, 858, "720p").height).toBe(720);
  });
  it("rounds odd sources to even sizes and tolerates a missing size", () => {
    const d = desktopProxyDimensions(1921, 1081, "half");
    expect(d.width % 2).toBe(0);
    expect(d.height % 2).toBe(0);
    expect(desktopProxyDimensions(0, 0, "half")).toEqual({ width: 0, height: 0 });
  });
});

describe("desktop proxy file names", () => {
  it("uses the codec extension and a short id so same-named clips never collide", () => {
    expect(desktopProxyFileName({ id: "abcdef12-0000", name: "Interview.mov" }, { codec: "prores-proxy", size: "half" })).toBe("Interview-abcdef12_half_proxy.mov");
    expect(desktopProxyFileName({ id: "zzzz", name: "a:b*c.mp4" }, { codec: "h264", size: "720p" })).toBe("a_b_c-zzzz_720p_proxy.mp4");
    expect(desktopPreviewTwinName("x_half_proxy.mov")).toBe("x_half_proxy.preview.mp4");
  });
});

describe("uniqueCopyName", () => {
  it("keeps a free name and numbers a taken one, case-insensitively", () => {
    expect(uniqueCopyName("a.mp4", new Set())).toBe("a.mp4");
    expect(uniqueCopyName("a.mp4", new Set(["A.MP4"]))).toBe("a (2).mp4");
    expect(uniqueCopyName("a.mp4", new Set(["a.mp4", "a (2).mp4"]))).toBe("a (3).mp4");
    expect(uniqueCopyName("noext", new Set(["noext"]))).toBe("noext (2)");
  });
});

describe("relink matching", () => {
  it("matches by name (any extension), duration and frame rate", () => {
    expect(scoreRelinkCandidate(target(), file())).not.toBeNull();
    expect(scoreRelinkCandidate(target(), file({ name: "other.mov" }))).toBeNull();
    expect(scoreRelinkCandidate(target(), file({ duration: 20 }))).toBeNull();
    expect(scoreRelinkCandidate(target(), file({ frameRate: 25 }))).toBeNull();
  });
  it("accepts a duration within the same tolerance as proxies (0.25 s / 1 %)", () => {
    expect(scoreRelinkCandidate(target(), file({ duration: 12.6 }))).not.toBeNull();
    expect(scoreRelinkCandidate(target({ duration: 600 }), file({ duration: 605 }))).not.toBeNull();
    expect(scoreRelinkCandidate(target({ duration: 600 }), file({ duration: 607 }))).toBeNull();
  });
  it("never matches a file it could not probe", () => {
    expect(scoreRelinkCandidate(target(), file({ duration: undefined }))).toBeNull();
    expect(scoreRelinkCandidate(target(), file({ duration: Number.NaN }))).toBeNull();
  });
  it("ignores duration and frame rate for images and frame rate for audio", () => {
    expect(scoreRelinkCandidate(target({ type: "image", name: "p.png", duration: 5 }), file({ name: "p.png", duration: undefined }))).not.toBeNull();
    expect(scoreRelinkCandidate(target({ type: "audio", name: "a.wav", frameRate: 0 }), file({ name: "a.wav", frameRate: 30 }))).not.toBeNull();
  });
  it("matches proxies by their proxy-suffixed names", () => {
    expect(scoreRelinkCandidate(target(), file({ name: "A001_C002_proxy.mp4" }), { proxy: true })).not.toBeNull();
    expect(scoreRelinkCandidate(target(), file({ name: "A001_C002_proxy.mp4" }))).toBeNull();
  });
  it("pairs this app's own proxy file names, including the preview twin, with the media name", () => {
    const own = desktopProxyFileName({ id: "abcdef12-9", name: "A001_C002.MOV" }, { codec: "prores-proxy", size: "half" });
    expect(scoreRelinkCandidate(target(), file({ name: own }), { proxy: true })).not.toBeNull();
    expect(scoreRelinkCandidate(target(), file({ name: desktopPreviewTwinName(own) }), { proxy: true })).not.toBeNull();
  });
  it("prefers the closer duration and an identical size, and reports ties as ambiguous", () => {
    const close = file({ path: "/b/A001_C002.mov", duration: 12.51, size: 5 });
    const exact = file({ path: "/c/A001_C002.mov", duration: 12.5, size: 1000 });
    const r = matchRelinkCandidates([target()], [close, exact]);
    expect(r.matches.map((m) => m.candidate.path)).toEqual(["/c/A001_C002.mov"]);

    const twinA = file({ path: "/x/A001_C002.mov", size: 7 });
    const twinB = file({ path: "/y/A001_C002.mov", size: 7 });
    const tie = matchRelinkCandidates([target({ size: 9 })], [twinA, twinB]);
    expect(tie.matches).toEqual([]);
    expect(tie.ambiguous[0].candidates).toHaveLength(2);
  });
  it("never links two media to one file and lists what stayed unmatched", () => {
    const shared = file();
    const r = matchRelinkCandidates([target({ id: "a" }), target({ id: "b" }), target({ id: "c", name: "zzz.mov" })], [shared, file({ path: "/n/unused.mov", name: "unused.mov" })]);
    expect(r.matches).toHaveLength(1);
    expect(r.ambiguous.map((entry) => entry.mediaId)).toContain("b");
    expect(r.unmatchedMediaIds).toEqual(["c"]);
    expect(r.unusedCandidates.map((c) => c.name)).toEqual(["unused.mov"]);
  });
});

describe("proxy state summary", () => {
  it("counts ready / building / missing / failed", () => {
    const counts = summarizeProxyStates(["ready", "ready", "building", "failed", "missing-proxy", "missing-full", "none"]);
    expect(counts).toEqual({ total: 7, ready: 2, building: 1, missing: 2, failed: 1, none: 1 });
    expect(formatProxyCounts(counts)).toBe("2 ready · 1 building · 2 missing · 1 failed");
    expect(formatProxyCounts(summarizeProxyStates([]))).toBe("");
  });
});

describe("describeExportSource", () => {
  it("states full-resolution on desktop even when nothing is proxied", () => {
    expect(describeExportSource({ proxiedMedia: 0, message: "m" }, true)).toMatch(/full-resolution source files/);
    expect(describeExportSource({ proxiedMedia: 2, message: "m" }, true)).toMatch(/2 proxied clips were not used/);
    expect(describeExportSource({ proxiedMedia: 0, message: "m" }, false)).toBe("");
    expect(describeExportSource({ proxiedMedia: 1, message: "web msg" }, false)).toBe("web msg");
  });
});

describe("isDesktopIngestConfig", () => {
  it("accepts partial configs and rejects bad values", () => {
    expect(isDesktopIngestConfig({})).toBe(true);
    expect(isDesktopIngestConfig({ proxyProfile: { codec: "prores-proxy", size: "quarter" }, concurrency: 2, proxyFolder: "/p" })).toBe(true);
    expect(isDesktopIngestConfig({ proxyProfile: { codec: "dnxhd", size: "half" } })).toBe(false);
    expect(isDesktopIngestConfig({ concurrency: 3 })).toBe(false);
    expect(isDesktopIngestConfig({ proxyFolder: " " })).toBe(false);
  });
});
