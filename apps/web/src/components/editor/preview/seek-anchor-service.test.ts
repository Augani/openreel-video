import { afterEach, describe, expect, it, vi } from "vitest";
import { SeekAnchorService, maxAnchorsForBudget } from "./seek-anchor-service";

const bitmap = () => ({ width: 8, height: 8, close: vi.fn() }) as unknown as ImageBitmap;

describe("SeekAnchorService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("samples queued blobs after the start delay and serves nearest anchors", async () => {
    vi.useFakeTimers();
    const sample = vi.fn(async (_blob: Blob, options) => {
      options.onAnchor({ time: 0, bitmap: bitmap() });
      options.onAnchor({ time: 2, bitmap: bitmap() });
      return { completed: true, anchors: 2, durationSeconds: 4, width: 8, height: 8 };
    });
    const service = new SeekAnchorService(sample as never, 100);
    const blob = new Blob(["a"]);
    service.setBlobs([blob], () => true);
    expect(sample).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(sample).toHaveBeenCalledTimes(1);
    expect(service.status(blob)).toBe("done");
    expect(service.nearest(blob, 1.6, 2)?.time).toBe(2);
    service.dispose();
  });

  it("drops anchors and aborts when a blob leaves the timeline", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const closed = bitmap();
    const sample = vi.fn(async (_blob: Blob, options) => {
      signal = options.signal;
      options.onAnchor({ time: 0, bitmap: closed });
      return { completed: true, anchors: 1, durationSeconds: 1, width: 8, height: 8 };
    });
    const service = new SeekAnchorService(sample as never, 10);
    const blob = new Blob(["b"]);
    service.setBlobs([blob], () => true);
    await vi.advanceTimersByTimeAsync(20);
    service.setBlobs([], () => true);
    expect(signal?.aborted).toBe(true);
    expect(service.nearest(blob, 0, 1)).toBeNull();
    expect(service.index.byteLength).toBe(0);
    expect(closed.close).toHaveBeenCalled();
  });

  it("marks a failed sampling job as failed and does not retry it", async () => {
    vi.useFakeTimers();
    const sample = vi.fn(async () => {
      throw new Error("decode failed");
    });
    const service = new SeekAnchorService(sample as never, 10);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blob = new Blob(["c"]);
    service.setBlobs([blob], () => true);
    await vi.advanceTimersByTimeAsync(20);
    expect(service.status(blob)).toBe("failed");
    service.setBlobs([blob], () => true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sample).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    service.dispose();
  });

  it("samples only the blobs in the sampling window, nearest first, and starts the rest when they enter it", async () => {
    vi.useFakeTimers();
    const sampled: Blob[] = [];
    const sample = vi.fn(async (blob: Blob, options) => {
      sampled.push(blob);
      options.onAnchor({ time: 0, bitmap: bitmap() });
      return { completed: true, anchors: 1, durationSeconds: 1, width: 8, height: 8 };
    });
    const service = new SeekAnchorService(sample as never, 10, 0);
    const [near, mid, far] = [new Blob(["n"]), new Blob(["m"]), new Blob(["f"])];
    service.setBlobs([far, mid, near], () => true, [near, mid]);
    await vi.advanceTimersByTimeAsync(50);
    expect(sampled).toEqual([near, mid]);
    expect(service.status(far)).toBe("unknown");
    service.setBlobs([far, mid, near], () => true, [far]);
    await vi.advanceTimersByTimeAsync(50);
    expect(sampled).toEqual([near, mid, far]);
    // Anchors of sources that left the window are kept until the byte budget needs them.
    expect(service.nearest(near, 0, 1)).not.toBeNull();
    service.dispose();
  });

  it("resizes the anchor budget and closes evicted anchors", () => {
    const service = new SeekAnchorService((async () => ({ completed: false })) as never, 10);
    const a = bitmap();
    const b = bitmap();
    service.index.add(1, 0, a);
    service.index.add(2, 0, b);
    service.index.setMaxBytes(8 * 8 * 4);
    expect(a.close).toHaveBeenCalled();
    expect(b.close).not.toHaveBeenCalled();
    expect(service.index.byteLength).toBe(8 * 8 * 4);
  });

  it("plans fewer anchors per media under a smaller budget", () => {
    expect(maxAnchorsForBudget(48 * 1024 * 1024)).toBeGreaterThan(maxAnchorsForBudget(12 * 1024 * 1024));
    expect(maxAnchorsForBudget(1)).toBe(12);
    expect(maxAnchorsForBudget(10 * 1024 ** 3)).toBe(150);
  });
});
