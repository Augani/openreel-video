import { describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { PreviewProxyCache, computeProxyCacheBytes, computeProxyConcurrency } from "./preview-proxy-cache";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const media = (id = "video", blob = new Blob(["original"], { type: "video/mp4" })): MediaItem => ({
  id, name: `${id}.mp4`, type: "video", blob, fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { width: 1920, height: 1080, duration: 10, frameRate: 30, codec: "avc", sampleRate: 48000, channels: 2, fileSize: blob.size },
});
const project = (items: MediaItem[], id = "project"): Project => ({ id, mediaLibrary: { items } }) as Project;
const ready = async (cache: PreviewProxyCache, id: string) => vi.waitFor(() => expect(cache.store.getState().entries[id]?.status).toBe("ready"));

describe("session preview proxies", () => {
  it("changes only the preview source; export, audio originals and project media retain the original Blob", async () => {
    const item = media();
    const originalProject = project([item]);
    const proxy = new Blob(["smaller"]);
    const cache = new PreviewProxyCache({ loadOriginal: async () => item.blob!, generate: async () => proxy, inspect: async () => ({ width: 1280, height: 720 }) });
    cache.syncProject(originalProject);
    cache.request(item, "medium");
    await ready(cache, item.id);
    expect(cache.resolve(originalProject.id, item).blob).toBe(proxy);
    expect(cache.resolve(originalProject.id, item, "export")).toBe(item);
    expect(originalProject.mediaLibrary.items[0].blob).toBe(item.blob);
    expect(cache.store.getState().entries[item.id]).toMatchObject({ width: 1280, height: 720 });
    cache.setEnabled(item.id, false);
    expect(cache.resolve(originalProject.id, item)).toBe(item);
    cache.setEnabled(item.id, true);
    cache.failPlayback(item.id, proxy);
    expect(cache.resolve(originalProject.id, item)).toBe(item);
    expect(cache.store.getState().entries[item.id]?.error).toContain("Using the original");
  });

  it("ignores late progress/completion after project switch, including a reused media id", async () => {
    const item = media();
    const encoded = deferred<Blob>();
    const generate = vi.fn((_file, _preset, _progress, _signal) => encoded.promise);
    const cache = new PreviewProxyCache({ loadOriginal: async () => item.blob!, generate });
    cache.syncProject(project([item]));
    cache.request(item, "low");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    const signal = generate.mock.calls[0][3] as AbortSignal;
    cache.syncProject(project([item], "different-project"));
    expect(signal.aborted).toBe(true);
    generate.mock.calls[0][2](0.8);
    encoded.resolve(new Blob(["late"]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cache.store.getState().entries).toEqual({});
    expect(cache.resolve("different-project", item)).toBe(item);
  });

  it("rejects relinked sources and serializes replacement generation without stale failure overriding it", async () => {
    const old = media();
    const replacement = media(old.id, new Blob(["replacement"]));
    const stale = deferred<Blob>();
    const newProxy = new Blob(["new-proxy"]);
    const generate = vi.fn().mockImplementationOnce(() => stale.promise).mockResolvedValue(newProxy);
    const cache = new PreviewProxyCache({ loadOriginal: async (_id, item) => item.blob!, generate });
    cache.syncProject(project([old]));
    cache.request(old, "low");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    cache.syncProject(project([replacement]));
    cache.request(replacement, "high");
    expect(cache.store.getState().entries[old.id]?.status).toBe("queued");
    stale.resolve(new Blob(["old-proxy"]));
    await ready(cache, old.id);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(cache.resolve("project", replacement).blob).toBe(newProxy);
    expect(cache.resolve("project", old)).toBe(old);
    cache.failPlayback(old.id, new Blob(["old-proxy"]));
    expect(cache.resolve("project", replacement).blob).toBe(newProxy);
  });

  it("cancels queued/active jobs, does not invalidate decoding on progress, and clears on project close", async () => {
    const a = media("a"), b = media("b");
    const encoded = deferred<Blob>();
    const generate = vi.fn((_file, _preset, _progress, _signal) => encoded.promise);
    const cache = new PreviewProxyCache({ loadOriginal: async (_id, item) => item.blob!, generate });
    cache.syncProject(project([a, b]));
    cache.request(a, "low");
    cache.request(b, "low");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    const revision = cache.store.getState().revision;
    generate.mock.calls[0][2](0.45);
    expect(cache.store.getState().revision).toBe(revision);
    cache.remove(b.id);
    cache.remove(a.id);
    expect((generate.mock.calls[0][3] as AbortSignal).aborted).toBe(true);
    encoded.resolve(new Blob(["cancelled"]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generate).toHaveBeenCalledOnce();
    expect(cache.store.getState().entries).toEqual({});
    cache.syncProject(null);
    expect(cache.store.getState().projectId).toBeNull();
  });

  it("evicts oldest previews within the byte budget and cleans removed assets", async () => {
    const a = media("a"), b = media("b");
    const cache = new PreviewProxyCache({ maxBytes: 10, loadOriginal: async (_id, item) => item.blob!, generate: async () => new Blob(["123456"]) });
    cache.syncProject(project([a, b]));
    cache.request(a, "low");
    await ready(cache, a.id);
    cache.request(b, "low");
    await ready(cache, b.id);
    expect(cache.store.getState().entries[a.id]).toBeUndefined();
    expect(cache.resolve("project", a)).toBe(a);
    cache.syncProject(project([a]));
    expect(cache.store.getState().entries).toEqual({});
  });

  it("guards a deferred original-file read and a deferred metadata inspection against cancellation", async () => {
    const item = media();
    const original = deferred<Blob>();
    const inspected = deferred<{ width: number; height: number }>();
    const generate = vi.fn().mockResolvedValue(new Blob(["proxy"]));
    const inspect = vi.fn(() => inspected.promise);
    const cache = new PreviewProxyCache({ loadOriginal: () => original.promise, generate, inspect });
    cache.syncProject(project([item]));
    cache.request(item, "medium");
    cache.remove(item.id);
    original.resolve(item.blob!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generate).not.toHaveBeenCalled();
    cache.request(item, "medium");
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledOnce());
    cache.syncProject(null);
    inspected.resolve({ width: 1280, height: 720 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cache.store.getState().entries).toEqual({});
  });
});

describe("proxy cache sizing and scheduling", () => {
  it("scales the cap with RAM on desktop only and clamps it", () => {
    const GB = 1024 ** 3;
    expect(computeProxyCacheBytes(32 * GB, false)).toBe(256 * 1024 * 1024);
    expect(computeProxyCacheBytes(16 * GB, true)).toBe(Math.floor(0.8 * GB));
    expect(computeProxyCacheBytes(null, true)).toBe(256 * 1024 * 1024);
  });

  it("scales concurrency from cores, 1 to 3, and stays serial on web", () => {
    expect(computeProxyConcurrency(16, false)).toBe(1);
    expect(computeProxyConcurrency(8, true)).toBe(2);
  });

  it("runs jobs in parallel up to the limit and holds the queue while paused", async () => {
    const items = [media("a"), media("b"), media("c")];
    let paused = true;
    let inFlight = 0;
    let peak = 0;
    const cache = new PreviewProxyCache({
      loadOriginal: async (_p, item) => item.blob!,
      generate: async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight--; return new Blob(["p"]); },
      getConcurrency: () => 2,
      isPaused: () => paused,
    });
    cache.syncProject(project(items));
    for (const item of items) cache.request(item, "medium");
    await new Promise((r) => setTimeout(r, 30));
    expect(items.every((item) => cache.store.getState().entries[item.id].status === "queued")).toBe(true);
    paused = false;
    cache.resume();
    for (const item of items) await ready(cache, item.id);
    expect(peak).toBe(2);
  });
});

describe("Toggle Proxies and persisted proxies", () => {
  it("the global switch changes the decoded source, hydrated entries survive eviction and decodes are logged", async () => {
    const item = media();
    const p = project([item]);
    const proxy = new Blob(["stored-proxy"]);
    const cache = new PreviewProxyCache({ loadOriginal: async () => item.blob!, generate: async () => new Blob(["x"]) });
    cache.syncProject(p);
    cache.hydrate(item, proxy, { width: 960, height: 540 });
    expect(cache.resolve(p.id, item).blob).toBe(proxy);
    const revision = cache.store.getState().revision;
    cache.setProxiesOn(false);
    expect(cache.store.getState().revision).toBe(revision + 1);
    expect(cache.resolve(p.id, item)).toBe(item);
    cache.noteDecode(item.id, item.blob);
    expect(cache.decodes[item.id]).toMatchObject({ source: "original", originalCount: 1, proxyCount: 0 });
    cache.setProxiesOn(true);
    cache.noteDecode(item.id, proxy);
    expect(cache.decodes[item.id]).toMatchObject({ source: "proxy", proxyCount: 1 });
    expect(cache.resolve(p.id, item, "export")).toBe(item);
    expect(cache.store.getState().entries[item.id]?.persisted).toBe(true);
  });
});

