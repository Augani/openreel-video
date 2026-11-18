import { beforeEach, afterEach, describe, expect, it, vi, type MockInstance } from "vitest";

describe("composed project preview cache", () => {
  let cache: typeof import("./project-preview-cache");
  let source: HTMLCanvasElement;
  let encode: MockInstance<Parameters<HTMLCanvasElement["toDataURL"]>, string>;
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    cache = await import("./project-preview-cache");
    source = document.createElement("canvas"); source.width = 1920; source.height = 1080;
    encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,actual-frame");
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("encodes once per immutable revision, off the paused paint, and rejects stale timestamps", () => {
    const revision = { id: "a", modifiedAt: 1 };
    cache.cacheProjectPreview(revision, 41, source);
    cache.cacheProjectPreview(revision, 41, source);
    expect(encode).not.toHaveBeenCalled();
    expect(cache.getProjectPreview("a")).toBeUndefined();
    vi.runOnlyPendingTimers();
    cache.cacheProjectPreview(revision, 41, source);
    expect(encode).toHaveBeenCalledOnce();
    expect(cache.getProjectPreview("a", 1)).toEqual({ duration: 41, modifiedAt: 1, thumbnailUrl: "data:image/jpeg;base64,actual-frame" });
    expect(cache.getProjectPreview("a", 2)).toBeUndefined();
  });

  it("only publishes the latest pixels and lets an undone canceled revision be captured again", () => {
    const first = { id: "a", modifiedAt: 1 }, second = { id: "a", modifiedAt: 2 };
    cache.cacheProjectPreview(first, 10, source);
    cache.cacheProjectPreview(second, 20, source);
    vi.runOnlyPendingTimers();
    expect(encode).toHaveBeenCalledOnce();
    expect(cache.getProjectPreview("a")?.duration).toBe(20);
    cache.cacheProjectPreview(first, 10, source);
    vi.runOnlyPendingTimers();
    expect(encode).toHaveBeenCalledTimes(2);
    expect(cache.getProjectPreview("a")?.modifiedAt).toBe(1);
  });

  it("bounds both pending canvas copies and completed previews across project switches", () => {
    const revisions = Array.from({length: 14}, (_, id) => ({id: String(id), modifiedAt: id}));
    for (const revision of revisions) cache.cacheProjectPreview(revision, 10, source);
    vi.runOnlyPendingTimers();
    expect(encode).toHaveBeenCalledTimes(12);
    expect(cache.getProjectPreview("0")).toBeUndefined();
    cache.cacheProjectPreview(revisions[0], 10, source);
    vi.runOnlyPendingTimers();
    expect(cache.getProjectPreview("0")).toBeDefined();
    expect(cache.getProjectPreview("2")).toBeUndefined();
  });

  it("retries a failed encoding without publishing an invalid image", () => {
    const revision = {id: "a", modifiedAt: 1};
    encode.mockImplementationOnce(() => { throw new DOMException("Tainted canvas", "SecurityError"); });
    cache.cacheProjectPreview(revision, 10, source); vi.runOnlyPendingTimers();
    expect(cache.getProjectPreview("a")).toBeUndefined();
    cache.cacheProjectPreview(revision, 10, source); vi.runOnlyPendingTimers();
    expect(cache.getProjectPreview("a")?.thumbnailUrl).toContain("actual-frame");
  });

  it("cancels idle work on replacement and ignores a late obsolete callback", () => {
    const jobs: Array<(deadline: IdleDeadline) => void> = [];
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", (job: (deadline: IdleDeadline) => void) => jobs.push(job));
    vi.stubGlobal("cancelIdleCallback", cancel);
    const first = {id: "a", modifiedAt: 1};
    cache.cacheProjectPreview(first, 10, source);
    cache.cacheProjectPreview({id: "a", modifiedAt: 2}, 20, source);
    expect(cancel).toHaveBeenCalledWith(1);
    cache.cacheProjectPreview(first, 30, source);
    jobs[0]({} as IdleDeadline);
    expect(encode).not.toHaveBeenCalled();
    jobs[1]({} as IdleDeadline);
    expect(encode).not.toHaveBeenCalled();
    jobs[2]({} as IdleDeadline);
    expect(cache.getProjectPreview("a")?.duration).toBe(30);
  });
});
