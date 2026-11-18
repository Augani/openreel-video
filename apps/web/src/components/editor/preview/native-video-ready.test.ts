import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seekVideoFrame } from "./native-video-ready";

type NativeFrameCallback = Parameters<
  HTMLVideoElement["requestVideoFrameCallback"]
>[0];

class FakeVideo extends EventTarget {
  readyState = 1;
  seeking = false;
  time = 0;
  onSeek?: () => void;
  callbacks = new Map<number, NativeFrameCallback>();
  private nextId = 0;
  get currentTime() {
    return this.time;
  }
  set currentTime(value: number) {
    this.time = value;
    this.seeking = true;
    this.onSeek?.();
  }
  requestVideoFrameCallback = vi.fn((callback: NativeFrameCallback) => {
    const id = ++this.nextId;
    this.callbacks.set(id, callback);
    return id;
  });
  cancelVideoFrameCallback = vi.fn((id: number) => {
    this.callbacks.delete(id);
  });
  present() {
    this.readyState = 2;
    this.seeking = false;
    for (const [id, callback] of [...this.callbacks]) {
      this.callbacks.delete(id);
      callback(0, { mediaTime: this.time } as Parameters<NativeFrameCallback>[1]);
    }
  }
  asVideo() {
    return this as unknown as HTMLVideoElement;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("native paused-video readiness", () => {
  it("registers the frame callback before seeking and captures the first newly decoded frame without a timeout delay", async () => {
    const video = new FakeVideo();
    video.onSeek = () => {
      expect(video.requestVideoFrameCallback).toHaveBeenCalledOnce();
      video.present();
      video.dispatchEvent(new Event("seeked"));
    };
    await seekVideoFrame(video.asVideo(), 12);
    expect(video.time).toBe(12);
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses seeked/current data even if the browser never delivers a paused frame callback", async () => {
    const video = new FakeVideo();
    video.onSeek = () => {
      video.readyState = 2;
      video.seeking = false;
      video.dispatchEvent(new Event("seeked"));
    };
    await seekVideoFrame(video.asVideo(), 4);
    expect(video.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("accepts the cold first frame at exact zero when loading data emits no seeked or compositor event", async () => {
    const video = new FakeVideo();
    video.onSeek = () => {
      // A native element already at zero need not perform another seek.
      video.seeking = false;
    };
    const waiting = seekVideoFrame(video.asVideo(), 0);
    expect(video.time).toBe(0);
    video.readyState = 2;
    video.dispatchEvent(new Event("loadeddata"));
    await waiting;
    expect(video.time).toBe(0);
    expect(video.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not accept a ready event for a different target or an unfinished seek", async () => {
    const video = new FakeVideo();
    let ready = false;
    const waiting = seekVideoFrame(video.asVideo(), 8).then(() => {
      ready = true;
    });
    video.readyState = 2;
    video.dispatchEvent(new Event("loadeddata"));
    await Promise.resolve();
    expect(ready).toBe(false);
    video.seeking = false;
    video.time = 3;
    video.dispatchEvent(new Event("seeked"));
    await Promise.resolve();
    expect(ready).toBe(false);
    video.time = 8;
    video.dispatchEvent(new Event("loadeddata"));
    await waiting;
    expect(ready).toBe(true);
  });
  it("cancels an obsolete seek immediately and removes its callback/timer", async () => {
    const video = new FakeVideo();
    const controller = new AbortController();
    const waiting = seekVideoFrame(video.asVideo(), 7, controller.signal);
    const rejected = expect(waiting).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejected;
    expect(video.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects a stalled decode instead of capturing its old pixels", async () => {
    const video = new FakeVideo();
    const waiting = seekVideoFrame(video.asVideo(), 7);
    const rejected = expect(waiting).rejects.toThrow("could not be decoded");
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(video.callbacks.size).toBe(0);
  });
});
