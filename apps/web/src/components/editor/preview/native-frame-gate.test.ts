import { describe, expect, it, vi } from "vitest";
import { IntervalGate, NativeFrameGate, VideoFrameTokens } from "./native-frame-gate";

function fakeVideo(withApi = true) {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  const request = vi.fn((cb: () => void) => {
    const id = next++;
    callbacks.set(id, cb);
    return id;
  });
  const video = {
    requestVideoFrameCallback: withApi ? request : undefined,
    cancelVideoFrameCallback: vi.fn((id: number) => void callbacks.delete(id)),
  } as unknown as HTMLVideoElement;
  const present = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const cb of pending) cb();
  };
  return { video, present, callbacks, request };
}

describe("NativeFrameGate", () => {
  it("skips an identical key and draws when it changes", () => {
    const gate = new NativeFrameGate();
    expect(gate.shouldDraw("a")).toBe(true);
    expect(gate.shouldDraw("a")).toBe(false);
    expect(gate.shouldDraw("b")).toBe(true);
    expect(gate.shouldDraw("a")).toBe(true);
  });

  it("always draws on a null key and forgets the previous key", () => {
    const gate = new NativeFrameGate();
    gate.shouldDraw("a");
    expect(gate.shouldDraw(null)).toBe(true);
    expect(gate.shouldDraw("a")).toBe(true);
  });

  it("reset forces the next draw", () => {
    const gate = new NativeFrameGate();
    gate.shouldDraw("a");
    gate.reset();
    expect(gate.shouldDraw("a")).toBe(true);
  });
});

describe("VideoFrameTokens", () => {
  it("counts presented frames and re-arms the callback", () => {
    const tokens = new VideoFrameTokens();
    const { video, present } = fakeVideo();
    expect(tokens.token(video)).toBeNull();
    tokens.watch(video);
    expect(tokens.token(video)).toBe(0);
    present();
    present();
    expect(tokens.token(video)).toBe(2);
  });

  it("watches an element once", () => {
    const tokens = new VideoFrameTokens();
    const { video, request } = fakeVideo();
    tokens.watch(video);
    tokens.watch(video);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns null without requestVideoFrameCallback so the caller always redraws", () => {
    const tokens = new VideoFrameTokens();
    const { video } = fakeVideo(false);
    tokens.watch(video);
    expect(tokens.token(video)).toBeNull();
  });

  it("stops counting after dispose", () => {
    const tokens = new VideoFrameTokens();
    const { video, present, callbacks } = fakeVideo();
    tokens.watch(video);
    tokens.dispose();
    expect(callbacks.size).toBe(0);
    present();
    expect(tokens.token(video)).toBeNull();
  });
});

describe("IntervalGate", () => {
  it("allows the first call and then one per interval", () => {
    const gate = new IntervalGate(500);
    expect(gate.due(1000)).toBe(true);
    expect(gate.due(1200)).toBe(false);
    expect(gate.due(1500)).toBe(true);
  });
});
