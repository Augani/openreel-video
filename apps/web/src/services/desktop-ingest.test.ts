import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import type { OpenReelIngestBridge, OpenReelProxyEvent, OpenReelProxyJob } from "../types/global";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useProjectStore } from "../stores/project-store";

vi.mock("@openreel/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openreel/core")>()),
  getMediaEngine: () => ({ extractMetadata: async () => ({ hasVideo: true, canDecode: true, canDecodeVideo: true, width: 1920, height: 1080, duration: 5, frameRate: 30 }) }),
}));

import {
  copyMediaToProject,
  queueDesktopProxies,
  relinkFromFolder,
  startDesktopIngest,
  updateDesktopIngestConfig,
  useDesktopIngestStore,
} from "./desktop-ingest";

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
  const base = createEmptyProject("Desktop ingest");
  useProjectStore.getState().loadProject({ ...base, mediaLibrary: { ...base.mediaLibrary, items } });
  // loadProject marks blob-less items offline; these have blobs, keep them online.
  useProjectStore.setState((s) => ({ project: { ...s.project, mediaLibrary: { ...s.project.mediaLibrary, items } } }));
}

let emit: (event: OpenReelProxyEvent) => void = () => undefined;
const bridge = {
  resolveFolders: vi.fn(async () => ({ projectDir: "/p", proxyDir: "/p/Proxies", mediaDir: "/p/Media", projectSaved: true })),
  enqueueProxies: vi.fn(async (args: { items: Array<{ mediaId: string }> }) =>
    args.items.map((entry) => ({ id: `${useProjectStore.getState().project.id}:${entry.mediaId}`, status: "queued", progress: 0, mediaId: entry.mediaId, projectKey: useProjectStore.getState().project.id }) as unknown as OpenReelProxyJob),
  ),
  listProxyJobs: vi.fn(async () => [] as OpenReelProxyJob[]),
  cancelProxyJobs: vi.fn(async () => undefined),
  retryFailedProxyJobs: vi.fn(async () => [] as OpenReelProxyJob[]),
  ackProxyJobs: vi.fn(async () => undefined),
  setProxyConcurrency: vi.fn(async () => undefined),
  onProxyEvent: vi.fn((cb: (event: OpenReelProxyEvent) => void) => {
    emit = cb;
    return () => undefined;
  }),
  // Files under /p (the project) and /found exist; the original capture paths do not, so a project load does not auto-reconnect.
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
  useDesktopIngestStore.setState({ jobs: {}, files: {}, copying: {}, lastRelink: null, lastCopy: null, folders: null });
});
afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("native proxy queueing", () => {
  it("sends media with a known path to the native queue with the project profile, and shows the job at once", async () => {
    loadItems([item("a"), item("b", { sourceFile: { name: "b.mov", size: 1, lastModified: 1 } }), item("c", { isPlaceholder: true, blob: null }), item("d", { type: "audio" })]);
    await updateDesktopIngestConfig({ proxyProfile: { codec: "h264", size: "quarter" }, concurrency: 2 });
    const result = queueDesktopProxies(["a", "b", "c", "d", "ghost"]);
    expect(result.queued).toEqual(["a"]);
    // No path on disk (recording, generated media): the in-app encoder takes it.
    expect(result.legacy).toEqual(["b"]);
    expect(result.skipped.map((s) => [s.id, s.reason])).toEqual([
      ["c", "The full-resolution media is offline. Relink it first."],
      ["d", "Only video can be proxied."],
      ["ghost", "Media not found."],
    ]);
    expect(useDesktopIngestStore.getState().jobs.a.status).toBe("queued");
    await vi.waitFor(() => expect(bridge.enqueueProxies).toHaveBeenCalledTimes(1));
    const args = bridge.enqueueProxies.mock.calls[0][0] as unknown as { items: Array<Record<string, unknown>>; projectId: string; config: unknown };
    expect(args.items).toEqual([{ mediaId: "a", name: "a.mov", srcPath: "/cards/a.mov", profile: { codec: "h264", size: "quarter" }, previewTwin: false }]);
    expect(args.config).toMatchObject({ concurrency: 2 });
  });

  it("asks for an H.264 preview twin with a ProRes profile when the renderer cannot decode ProRes", async () => {
    loadItems([item("a")]);
    await updateDesktopIngestConfig({ proxyProfile: { codec: "prores-proxy", size: "half" } });
    queueDesktopProxies(["a"]);
    await vi.waitFor(() => expect(bridge.enqueueProxies).toHaveBeenCalled());
    const args = bridge.enqueueProxies.mock.calls[0][0] as unknown as { items: Array<{ previewTwin: boolean }> };
    expect(args.items[0].previewTwin).toBe(true); // no VideoDecoder in the test environment
  });

  it("does not re-queue what is already queued unless forced", () => {
    loadItems([item("a")]);
    expect(queueDesktopProxies(["a"]).queued).toEqual(["a"]);
    expect(queueDesktopProxies(["a"]).skipped[0].reason).toBe("Already queued.");
    expect(queueDesktopProxies(["a"], true).queued).toEqual(["a"]);
  });

  it("changing the proxy format is one undo step", async () => {
    loadItems([item("a")]);
    const history = useProjectStore.getState().actionHistory;
    const before = history.getUndoStackSize();
    expect(await updateDesktopIngestConfig({ proxyProfile: { codec: "prores-proxy", size: "720p" } })).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(useProjectStore.getState().project.mediaLibrary.desktopIngest?.proxyProfile).toEqual({ codec: "prores-proxy", size: "720p" });
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.mediaLibrary.desktopIngest).toBeUndefined();
  });
});

describe("finished native jobs", () => {
  const doneJob = (mediaId: string): OpenReelProxyJob => ({
    id: `${useProjectStore.getState().project.id}:${mediaId}`,
    projectKey: useProjectStore.getState().project.id,
    mediaId,
    srcPath: `/cards/${mediaId}.mov`,
    outDir: "/p/Proxies",
    fileName: `${mediaId}_half_proxy.mov`,
    profile: { codec: "prores-proxy", size: "half" },
    previewTwin: true,
    status: "done",
    progress: 1,
    attempts: 1,
    result: { outPath: `/p/Proxies/${mediaId}_half_proxy.mov`, previewPath: `/p/Proxies/${mediaId}_half_proxy.preview.mp4`, width: 1920, height: 1080, duration: 12, frameRate: 30, codec: "prores", fileSize: 999 },
  });

  it("links the proxy as one undo step, acknowledges the job and drops it from the panel state", async () => {
    loadItems([item("a")]);
    startDesktopIngest();
    const history = useProjectStore.getState().actionHistory;
    const before = history.getUndoStackSize();
    useDesktopIngestStore.setState({ jobs: { a: { ...doneJob("a"), status: "running" } } });
    emit({ type: "update", job: doneJob("a") });
    // The job is acknowledged once the link action has finished (and landed in the history).
    await vi.waitFor(() => expect(bridge.ackProxyJobs).toHaveBeenCalled());
    const ref = useProjectStore.getState().project.mediaLibrary.items[0].proxy!;
    expect(ref).toMatchObject({ path: "/p/Proxies/a_half_proxy.mov", previewPath: "/p/Proxies/a_half_proxy.preview.mp4", width: 1920, codec: "prores", profile: { codec: "prores-proxy", size: "half" }, source: "generated" });
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(bridge.ackProxyJobs).toHaveBeenCalledWith([doneJob("a").id]);
    expect(useDesktopIngestStore.getState().jobs.a).toBeUndefined();
    // Playback uses the preview twin, not the ProRes file.
    await vi.waitFor(() => expect(bridge.readProxy).toHaveBeenCalledWith("/p/Proxies/a_half_proxy.preview.mp4"));
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.mediaLibrary.items[0].proxy).toBeUndefined();
  });

  it("a proxy whose media was removed is acknowledged and not linked", async () => {
    loadItems([item("a")]);
    startDesktopIngest();
    emit({ type: "update", job: doneJob("gone") });
    await vi.waitFor(() => expect(bridge.ackProxyJobs).toHaveBeenCalled());
    expect(useProjectStore.getState().project.mediaLibrary.items[0].proxy).toBeUndefined();
  });
});

describe("copy to project", () => {
  it("points the project at the verified copies in one undo step and keeps a record of the original", async () => {
    loadItems([item("a"), item("b"), item("c", { copiedFrom: { path: "/x", sha256: "s", copiedAt: 1 } })]);
    bridge.copyToProject.mockImplementation(async (args: { srcPath: string }) => ({ destPath: args.srcPath.replace("/cards/", "/p/Media/"), sha256: "abc", size: 1000, alreadyInPlace: false }));
    const history = useProjectStore.getState().actionHistory;
    const before = history.getUndoStackSize();
    const report = await copyMediaToProject(["a", "b", "c"]);
    expect(report.copied.map((c) => c.path)).toEqual(["/p/Media/a.mov", "/p/Media/b.mov"]);
    expect(report.skipped).toEqual([{ name: "c.mov", reason: "Already copied to the project." }]);
    expect(history.getUndoStackSize()).toBe(before + 1);
    const [a] = useProjectStore.getState().project.mediaLibrary.items;
    expect(a.sourceFile).toMatchObject({ path: "/p/Media/a.mov", folder: "Media", name: "a.mov" });
    expect(a.copiedFrom).toMatchObject({ path: "/cards/a.mov", sha256: "abc" });
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.mediaLibrary.items[0].sourceFile?.path).toBe("/cards/a.mov");
    expect(useProjectStore.getState().project.mediaLibrary.items[0].copiedFrom).toBeUndefined();
  });

  it("changes nothing when a copy fails, and says why", async () => {
    loadItems([item("a")]);
    bridge.copyToProject.mockRejectedValue(new Error("Error invoking remote method 'x': Error: The copy failed checksum verification."));
    const history = useProjectStore.getState().actionHistory;
    const before = history.getUndoStackSize();
    const report = await copyMediaToProject(["a"]);
    expect(report.copied).toEqual([]);
    expect(report.skipped[0].reason).toBe("The copy failed checksum verification.");
    expect(history.getUndoStackSize()).toBe(before);
    expect(useProjectStore.getState().project.mediaLibrary.items[0].sourceFile?.path).toBe("/cards/a.mov");
  });
});

describe("relink by folder search", () => {
  it("relinks offline media matched by name + duration + frame rate and leaves a same-named clip of another length alone", async () => {
    loadItems([item("a", { isPlaceholder: true, blob: null }), item("b", { isPlaceholder: true, blob: null })]);
    bridge.scanFolder.mockResolvedValue({
      visited: 40,
      truncated: false,
      candidates: [
        { path: "/found/x/a.mov", name: "a.mov", size: 1000, duration: 12, frameRate: 30 },
        { path: "/found/y/a.mov", name: "a.mov", size: 5, duration: 2, frameRate: 30 },
        { path: "/found/b.mov", name: "b.mov", size: 5, duration: 12, frameRate: 25 },
      ],
    });
    const replace = vi.fn(async () => ({ success: true }));
    useProjectStore.setState({ replaceMediaAsset: replace as never });
    const report = await relinkFromFolder("full");
    expect(bridge.scanFolder).toHaveBeenCalledWith({ root: "/found", names: ["a.mov", "b.mov"], mode: "media" });
    expect(report?.linked.map((l) => [l.mediaId, l.path])).toEqual([["a", "/found/x/a.mov"]]);
    expect(report?.notFound).toEqual(["b.mov"]);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]).toMatchObject([ "a", expect.any(File), undefined, { restorePlaceholder: true } ]);
  });

  it("relinks missing proxies by folder search as one undo step", async () => {
    loadItems([item("a", { proxy: { storage: "path", path: "/old/a_half_proxy.mp4", width: 1920, height: 1080, codec: "h264", frameRate: 30, duration: 12, fileSize: 1, status: "ready", source: "generated", createdAt: 1 } })]);
    useDesktopIngestStore.setState({ files: { a: { exists: false, previewable: false, path: "/old/a_half_proxy.mp4" } } });
    bridge.scanFolder.mockResolvedValue({ visited: 3, truncated: false, candidates: [{ path: "/found/a-a_half_proxy.mp4", name: "a-a_half_proxy.mp4", size: 77, duration: 12.05, frameRate: 30, width: 1920, height: 1080 }] });
    const history = useProjectStore.getState().actionHistory;
    const before = history.getUndoStackSize();
    const report = await relinkFromFolder("proxy");
    expect(report?.linked).toHaveLength(1);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(useProjectStore.getState().project.mediaLibrary.items[0].proxy).toMatchObject({ path: "/found/a-a_half_proxy.mp4", storage: "path", source: "attached" });
  });

  it("reports ambiguous files instead of guessing", async () => {
    loadItems([item("a", { isPlaceholder: true, blob: null })]);
    bridge.scanFolder.mockResolvedValue({
      visited: 2,
      truncated: false,
      candidates: [
        { path: "/f/1/a.mov", name: "a.mov", size: 5, duration: 12, frameRate: 30 },
        { path: "/f/2/a.mov", name: "a.mov", size: 5, duration: 12, frameRate: 30 },
      ],
    });
    const replace = vi.fn(async () => ({ success: true }));
    useProjectStore.setState({ replaceMediaAsset: replace as never });
    const report = await relinkFromFolder("full");
    expect(report?.linked).toEqual([]);
    expect(report?.ambiguous).toEqual([{ name: "a.mov", candidates: ["/f/1/a.mov", "/f/2/a.mov"] }]);
    expect(replace).not.toHaveBeenCalled();
  });
});
