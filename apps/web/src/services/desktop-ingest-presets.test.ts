import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopProxyProfile, MediaItem } from "@openreel/core";
import type { OpenReelIngestBridge, OpenReelProxyEvent, OpenReelProxyJob } from "../types/global";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useProjectStore } from "../stores/project-store";

vi.mock("@openreel/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openreel/core")>()),
  getMediaEngine: () => ({ extractMetadata: async () => ({ hasVideo: true, canDecode: true, canDecodeVideo: true, width: 1920, height: 1080, duration: 5, frameRate: 30 }) }),
}));

import {
  queueDesktopCopies,
  queueDesktopProxies,
  relinkFromFolder,
  setDesktopProxyProfile,
  startDesktopIngest,
  updateDesktopIngestConfig,
  useDesktopIngestStore,
} from "./desktop-ingest";
import { setProjectIngestMode } from "./proxy-ingest";

const item = (id: string, over: Partial<MediaItem> = {}): MediaItem => ({
  id,
  name: `${id}.mov`,
  type: "video",
  fileHandle: null,
  blob: new Blob(["x"]),
  waveformData: null,
  thumbnailUrl: null,
  metadata: { width: 3840, height: 2160, duration: 12, frameRate: 30, codec: "avc", sampleRate: 48000, channels: 2, fileSize: 1000 },
  sourceFile: { name: `${id}.mov`, size: 1000, lastModified: 1, path: `/cards/${id}.mov` },
  ...over,
});

function loadItems(items: MediaItem[]) {
  const base = createEmptyProject("Ingest presets");
  useProjectStore.getState().loadProject({ ...base, mediaLibrary: { ...base.mediaLibrary, items } });
  useProjectStore.setState((s) => ({ project: { ...s.project, mediaLibrary: { ...s.project.mediaLibrary, items } } }));
}
const library = () => useProjectStore.getState().project.mediaLibrary;
const pid = () => useProjectStore.getState().project.id;

let emit: (event: OpenReelProxyEvent) => void = () => undefined;
const copyJob = (mediaId: string, over: Partial<OpenReelProxyJob> = {}): OpenReelProxyJob => ({
  id: `${pid()}:copy:${mediaId}`,
  kind: "copy",
  projectKey: pid(),
  mediaId,
  name: `${mediaId}.mov`,
  srcPath: `/cards/${mediaId}.mov`,
  outDir: "/p/Media",
  fileName: `${mediaId}.mov`,
  profile: { codec: "h264", size: "half" },
  previewTwin: false,
  status: "queued",
  progress: 0,
  attempts: 0,
  ...over,
});
const bridge = {
  resolveFolders: vi.fn(async () => ({ projectDir: "/p", proxyDir: "/p/Proxies", mediaDir: "/p/Media", projectSaved: true })),
  enqueueProxies: vi.fn(async (args: { items: Array<{ mediaId: string }> }) => args.items.map((entry) => ({ id: `${pid()}:${entry.mediaId}`, status: "queued", progress: 0, mediaId: entry.mediaId, projectKey: pid() }) as unknown as OpenReelProxyJob)),
  enqueueCopies: vi.fn(async (args: { items: Array<{ mediaId: string }> }) => args.items.map((entry) => copyJob(entry.mediaId))),
  listProxyJobs: vi.fn(async () => [] as OpenReelProxyJob[]),
  cancelProxyJobs: vi.fn(async () => undefined),
  retryFailedProxyJobs: vi.fn(async () => [] as OpenReelProxyJob[]),
  ackProxyJobs: vi.fn(async () => undefined),
  setProxyConcurrency: vi.fn(async () => undefined),
  onProxyEvent: vi.fn((cb: (event: OpenReelProxyEvent) => void) => {
    emit = cb;
    return () => undefined;
  }),
  stat: vi.fn(async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, { exists: p.startsWith("/p/") || p.startsWith("/found"), size: 10 }]))),
  readProxy: vi.fn(async () => new ArrayBuffer(8)),
  copyToProject: vi.fn(),
  onCopyProgress: vi.fn(() => () => undefined),
  pickFolder: vi.fn(async () => "/found"),
  scanFolder: vi.fn(),
} satisfies OpenReelIngestBridge;

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { openreel: unknown }).openreel = { platform: "desktop", fs: { readFileBytes: async () => new ArrayBuffer(4), revealInFolder: async () => undefined }, ingest: bridge };
  useDesktopIngestStore.setState({ jobs: {}, copyJobs: {}, files: {}, copying: {}, lastRelink: null, lastCopy: null, folders: { proxyDir: "/p/Proxies", mediaDir: "/p/Media", projectSaved: true } });
});
afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("presets per project and per batch", () => {
  it("saves a preset's full profile and its id with the project (one undo step) and keeps it portable", async () => {
    loadItems([item("a")]);
    const profile: DesktopProxyProfile = { codec: "prores-lt", size: "custom", customWidth: 1280, audio: "strip", burnIn: { timecode: true }, destination: { mode: "media" } };
    const before = useProjectStore.getState().actionHistory.getUndoStackSize();
    expect(await setDesktopProxyProfile(profile, "user-1")).toBe(true);
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(before + 1);
    expect(library().desktopIngest).toMatchObject({ proxyProfile: profile, proxyPresetId: "user-1" });
    await useProjectStore.getState().undo();
    expect(library().desktopIngest).toBeUndefined();
  });
  it("rejects an invalid profile in the project", async () => {
    loadItems([item("a")]);
    expect(await updateDesktopIngestConfig({ proxyProfile: { codec: "h264", size: "custom" } as DesktopProxyProfile })).toBe(false);
  });
  it("a batch preset is used for that batch only; the project's preset is untouched", async () => {
    loadItems([item("a"), item("b")]);
    await setDesktopProxyProfile({ codec: "h264", size: "half" }, "h264-half");
    const batch: DesktopProxyProfile = { codec: "dnxhr-sq", size: "quarter", burnIn: { clipName: true } };
    queueDesktopProxies(["a"], false, batch);
    await vi.waitFor(() => expect(bridge.enqueueProxies).toHaveBeenCalledTimes(1));
    expect((bridge.enqueueProxies.mock.calls[0][0] as unknown as { items: Array<{ profile: unknown }> }).items[0].profile).toEqual(batch);
    queueDesktopProxies(["b"]);
    await vi.waitFor(() => expect(bridge.enqueueProxies).toHaveBeenCalledTimes(2));
    expect((bridge.enqueueProxies.mock.calls[1][0] as unknown as { items: Array<{ profile: unknown }> }).items[0].profile).toEqual({ codec: "h264", size: "half" });
    expect(library().desktopIngest?.proxyProfile).toEqual({ codec: "h264", size: "half" });
  });
});

describe("ingest setting on import", () => {
  it("None, Copy, Copy and create proxies and Create proxies are one undo step each", async () => {
    loadItems([item("a")]);
    const history = useProjectStore.getState().actionHistory;
    for (const [mode, preset, withProxies] of [["copy", "copy", false], ["copy-proxies", "copy", true], ["proxies", "proxies", false], ["none", "none", false]] as const) {
      const before = history.getUndoStackSize();
      expect(await setProjectIngestMode(mode)).toBe(true);
      expect(history.getUndoStackSize()).toBe(before + 1);
      expect(library().ingestPreset).toBe(preset);
      expect(Boolean(library().desktopIngest?.proxiesWithCopy)).toBe(withProxies);
    }
  });
});

describe("copy jobs in the background queue", () => {
  it("queues verified copies with the project's checksum and shows them at once", async () => {
    loadItems([item("a"), item("b", { copiedFrom: { path: "/x", sha256: "s", copiedAt: 1 } }), item("c", { sourceFile: undefined }), item("d", { isPlaceholder: true, blob: null })]);
    await updateDesktopIngestConfig({ checksum: "md5" });
    const result = await queueDesktopCopies(["a", "b", "c", "d"]);
    expect(result.queued).toEqual(["a"]);
    expect(result.skipped.map((s) => [s.name, s.reason])).toEqual([
      ["b.mov", "Already copied to the project."],
      ["c.mov", "It was not imported from a file on disk."],
      ["d.mov", "The media is offline."],
    ]);
    const args = bridge.enqueueCopies.mock.calls[0][0] as unknown as { items: unknown[]; algorithm: string; thenProxies?: unknown };
    expect(args.algorithm).toBe("md5");
    expect(args.items).toEqual([{ mediaId: "a", name: "a.mov", srcPath: "/cards/a.mov" }]);
    expect(args.thenProxies).toBeUndefined();
    expect(Object.keys(useDesktopIngestStore.getState().copyJobs)).toEqual(["a"]);
  });
  it("copy and create proxies passes the preset (batch or project) and shows the proxy as waiting", async () => {
    loadItems([item("a")]);
    await setDesktopProxyProfile({ codec: "prores-proxy", size: "half" }, "prores-proxy");
    await queueDesktopCopies(["a"], { thenProxies: true });
    const args = bridge.enqueueCopies.mock.calls[0][0] as unknown as { thenProxies: { profile: unknown; previewTwin: boolean } };
    expect(args.thenProxies.profile).toEqual({ codec: "prores-proxy", size: "half" });
    expect(args.thenProxies.previewTwin).toBe(true); // no ProRes decoder in the test renderer
    expect(useDesktopIngestStore.getState().jobs.a?.status).toBe("queued");
    await queueDesktopCopies(["a"], { thenProxies: true, proxyProfile: { codec: "h264", size: "720p" } });
  });
  it("does not queue the same copy twice", async () => {
    loadItems([item("a")]);
    await queueDesktopCopies(["a"]);
    const again = await queueDesktopCopies(["a"]);
    expect(again.skipped[0].reason).toBe("Already queued.");
    expect(bridge.enqueueCopies).toHaveBeenCalledTimes(1);
  });
  it("a refused queueing request clears the waiting rows and reports it", async () => {
    loadItems([item("a")]);
    bridge.enqueueCopies.mockRejectedValueOnce(new Error("Save the project first so its Media folder has a home."));
    const result = await queueDesktopCopies(["a"]);
    expect(result.queued).toEqual([]);
    expect(useDesktopIngestStore.getState().copyJobs).toEqual({});
  });
  it("links a finished copy: project points at the copy, the checksum is recorded and reported, one undo step, job acknowledged", async () => {
    loadItems([item("a")]);
    startDesktopIngest();
    const history = useProjectStore.getState().actionHistory;
    const before = history.getUndoStackSize();
    useDesktopIngestStore.setState({ copyJobs: { a: copyJob("a", { status: "running" }) } });
    emit({ type: "update", job: copyJob("a", { status: "done", progress: 1, copyResult: { destPath: "/p/Media/a.mov", size: 1000, checksum: { algorithm: "xxh64", value: "0123456789abcdef" }, reused: false } }) });
    await vi.waitFor(() => expect(bridge.ackProxyJobs).toHaveBeenCalled());
    const linked = library().items[0];
    expect(linked.sourceFile).toMatchObject({ path: "/p/Media/a.mov", folder: "Media" });
    expect(linked.copiedFrom).toMatchObject({ path: "/cards/a.mov", sha256: "", checksum: { algorithm: "xxh64", value: "0123456789abcdef" } });
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(useDesktopIngestStore.getState().copyJobs).toEqual({});
    expect(useDesktopIngestStore.getState().lastCopy?.copied).toEqual([{ mediaId: "a", name: "a.mov", path: "/p/Media/a.mov", sha256: "", algorithm: "xxh64", checksum: "0123456789abcdef" }]);
    await useProjectStore.getState().undo();
    expect(library().items[0].sourceFile?.path).toBe("/cards/a.mov");
    expect(library().items[0].copiedFrom).toBeUndefined();
  });
  it("a copy that finished while the app was closed is linked at the next launch, before its proxy", async () => {
    // The project opening is what asks the main process for the jobs left from the last session.
    bridge.listProxyJobs.mockImplementationOnce(async () => [
      copyJob("a", { status: "done", progress: 1, copyResult: { destPath: "/p/Media/a.mov", size: 1000, checksum: { algorithm: "md5", value: "abc" }, reused: true } }),
      copyJob("b", { status: "queued" }),
    ]);
    startDesktopIngest();
    loadItems([item("a"), item("b")]);
    await vi.waitFor(() => expect(library().items[0].sourceFile?.path).toBe("/p/Media/a.mov"));
    // Unfinished copies are shown again (the main process resumes them).
    expect(Object.keys(useDesktopIngestStore.getState().copyJobs)).toEqual(["b"]);
  });
  it("a failed copy stays visible with its reason, a cancelled one disappears and is cancelled in the queue", async () => {
    loadItems([item("a"), item("b")]);
    startDesktopIngest();
    emit({ type: "update", job: copyJob("a", { status: "failed", error: "The copy failed MD5 verification." }) });
    expect(useDesktopIngestStore.getState().copyJobs.a.error).toMatch(/MD5/);
    expect(useDesktopIngestStore.getState().lastCopy?.skipped[0]).toEqual({ name: "a.mov", reason: "The copy failed MD5 verification." });
    const { cancelDesktopCopy } = await import("./desktop-ingest");
    useDesktopIngestStore.setState({ copyJobs: { b: copyJob("b") } });
    cancelDesktopCopy("b");
    expect(useDesktopIngestStore.getState().copyJobs.b).toBeUndefined();
    expect(bridge.cancelProxyJobs).toHaveBeenCalledWith([`${pid()}:copy:b`]);
  });
});

describe("attach existing proxies by file name pattern", () => {
  const withMedia = () => loadItems([item("a"), item("b", { metadata: { ...item("b").metadata, frameRate: 25 } }), item("c")]);
  it("attaches fitting files by pattern and reports mismatches, ambiguity and missing proxies", async () => {
    withMedia();
    bridge.scanFolder.mockResolvedValue({
      visited: 9,
      truncated: false,
      candidates: [
        { path: "/found/a_LR.mp4", name: "a_LR.mp4", size: 5, duration: 12.1, frameRate: 30, width: 960, height: 540 },
        { path: "/found/b_LR.mp4", name: "b_LR.mp4", size: 5, duration: 12, frameRate: 30, width: 960, height: 540 },
      ],
    });
    const report = await relinkFromFolder("proxy", "/found", { pattern: "{name}_LR" });
    expect(bridge.scanFolder).toHaveBeenCalledWith({ root: "/found", names: ["a.mov", "b.mov", "c.mov"], mode: "proxy", proxyPattern: "{name}_LR" });
    expect(report?.pattern).toBe("{name}_LR");
    expect(report?.linked.map((l) => l.mediaId)).toEqual(["a"]);
    expect(report?.mismatched).toEqual([{ name: "b.mov", file: "b_LR.mp4", reasons: [expect.stringMatching(/Frame rate 30\.000 fps does not match the original 25\.000 fps/)] }]);
    expect(report?.notFound).toEqual(["c.mov"]);
    expect(library().items[0].proxy).toMatchObject({ path: "/found/a_LR.mp4", source: "attached" });
    expect(library().items[1].proxy).toBeUndefined();
  });
  it("a file with the right name but another duration is a mismatch, not a silent miss", async () => {
    loadItems([item("a")]);
    bridge.scanFolder.mockResolvedValue({ visited: 1, truncated: false, candidates: [{ path: "/found/a_proxy.mp4", name: "a_proxy.mp4", size: 5, duration: 40, frameRate: 30, width: 960, height: 540 }] });
    const report = await relinkFromFolder("proxy", "/found");
    expect(report?.linked).toEqual([]);
    expect(report?.mismatched[0].reasons[0]).toMatch(/Duration 40\.00s does not match the original 12\.00s/);
    expect(report?.notFound).toEqual([]);
  });
  it("an invalid pattern scans nothing", async () => {
    withMedia();
    expect(await relinkFromFolder("proxy", "/found", { pattern: "_proxy" })).toBeNull();
    expect(bridge.scanFolder).not.toHaveBeenCalled();
  });
});
