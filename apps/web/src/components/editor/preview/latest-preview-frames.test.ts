import { describe, expect, it, vi } from "vitest";
import {
  LatestPreviewFrames,
  type PreviewFrameRequest,
  type PreviewFrameState,
} from "./latest-preview-frames";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe("latest paused-preview frames", () => {
  it("coalesces rapid seeks and retains the latest renderer closure, without publishing old pixels", async () => {
    const frames = new LatestPreviewFrames();
    const first = deferred();
    const complete = deferred();
    const painted: string[] = [];
    const intermediate = vi.fn();
    let oldRequest!: PreviewFrameRequest;
    frames.request(1, async (_time, request) => {
      oldRequest = request;
      await first.promise;
      if (request.isCurrent()) painted.push("old project");
      return true;
    });
    frames.request(2, intermediate);
    frames.request(3, async (time, request) => {
      if (request.isCurrent()) painted.push(`new project at ${time}`);
      complete.resolve();
      return true;
    });
    expect(oldRequest.signal.aborted).toBe(true);
    first.resolve();
    await complete.promise;
    expect(intermediate).not.toHaveBeenCalled();
    expect(painted).toEqual(["new project at 3"]);
  });
  it("starts the newest frame as soon as an obsolete decode acknowledges cancellation", async () => {
    const frames = new LatestPreviewFrames();
    const complete = deferred();
    const order: number[] = [];
    frames.request(1, async (_time, request) => {
      await new Promise<void>((resolve) =>
        request.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      order.push(1);
      return false;
    });
    frames.request(8, async () => {
      order.push(8);
      complete.resolve();
      return true;
    });
    await complete.promise;
    expect(order).toEqual([1, 8]);
  });
  it("does not clear the latest busy state when an earlier job fails", async () => {
    const frames = new LatestPreviewFrames();
    const first = deferred();
    const complete = deferred();
    const states: PreviewFrameState[] = [];
    frames.subscribe((state) => states.push(state));
    frames.request(1, async () => {
      await first.promise;
      throw new Error("Old failure");
    });
    frames.request(5, async () => {
      complete.resolve();
      return true;
    });
    first.resolve();
    await complete.promise;
    await Promise.resolve();
    expect(states.filter((state) => state.error)).toEqual([]);
    expect(states.at(-1)).toMatchObject({ time: 5, busy: false });
  });
  it("reports a current rendering failure and recovers on the next request", async () => {
    const frames = new LatestPreviewFrames();
    const states: PreviewFrameState[] = [];
    frames.subscribe((state) => states.push(state));
    frames.request(1, async () => {
      throw new Error("Decoder unavailable");
    });
    await Promise.resolve();
    expect(states.at(-1)?.error).toBe("Decoder unavailable");
    frames.request(2, async () => true);
    await Promise.resolve();
    expect(states.at(-1)).toEqual({ busy: false, time: 2, error: null });
  });
  it("cancels pending work on playback/unmount and supports a later paused request", async () => {
    const frames = new LatestPreviewFrames();
    const first = deferred();
    const complete = deferred();
    const pending = vi.fn();
    let request!: PreviewFrameRequest;
    frames.request(1, async (_time, current) => {
      request = current;
      await first.promise;
      return true;
    });
    frames.request(2, pending);
    frames.cancel();
    expect(request.isCurrent()).toBe(false);
    first.resolve();
    await Promise.resolve();
    frames.request(3, async () => {
      complete.resolve();
      return true;
    });
    await complete.promise;
    expect(pending).not.toHaveBeenCalled();
  });

  it("lets an in-flight scrub render finish and present while only the newest scrub request waits", async () => {
    const frames = new LatestPreviewFrames();
    const gate = deferred();
    const done = deferred();
    const presented: number[] = [];
    const render = (time: number, wait?: Promise<void>) => async (_t: number, request: PreviewFrameRequest) => {
      await wait;
      if (request.isCurrent()) presented.push(time);
      if (time === 4) done.resolve();
      return true;
    };
    frames.request(1, render(1, gate.promise), { scrubbing: true });
    const skipped = vi.fn();
    frames.request(2, skipped, { scrubbing: true });
    frames.request(3, skipped, { scrubbing: true });
    frames.request(4, render(4), { scrubbing: true });
    gate.resolve();
    await done.promise;
    expect(skipped).not.toHaveBeenCalled();
    expect(presented).toEqual([1, 4]);
  });

  it("still aborts an in-flight scrub render when a settled (non-scrub) request arrives", async () => {
    const frames = new LatestPreviewFrames();
    const gate = deferred();
    const done = deferred();
    let scrubRequest!: PreviewFrameRequest;
    frames.request(1, async (_t, request) => {
      scrubRequest = request;
      await gate.promise;
      return true;
    }, { scrubbing: true });
    frames.request(2, async () => { done.resolve(); return true; });
    expect(scrubRequest.signal.aborted).toBe(true);
    expect(scrubRequest.isCurrent()).toBe(false);
    gate.resolve();
    await done.promise;
  });
});
