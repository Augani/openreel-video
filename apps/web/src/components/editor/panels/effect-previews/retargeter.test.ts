import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRetargeter } from "./retargeter";

describe("createRetargeter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs once, 300 ms after the last change of a scrub burst", () => {
    const evaluate = vi.fn();
    const retarget = createRetargeter({ delayMs: 300, isPlaying: () => false, evaluate });
    for (let tick = 0; tick < 50; tick++) {
      retarget.schedule();
      vi.advanceTimersByTime(20); // a scrub tick every 20 ms: never settles
    }
    expect(evaluate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(279); // 20 ms of the last tick already elapsed
    expect(evaluate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("does nothing while playing, and again once playback stops", () => {
    let playing = true;
    const evaluate = vi.fn();
    const retarget = createRetargeter({ delayMs: 300, isPlaying: () => playing, evaluate });
    retarget.schedule();
    vi.advanceTimersByTime(1_000);
    expect(evaluate).not.toHaveBeenCalled();
    playing = false;
    retarget.schedule();
    vi.advanceTimersByTime(300);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("cancel drops a pending run", () => {
    const evaluate = vi.fn();
    const retarget = createRetargeter({ delayMs: 300, isPlaying: () => false, evaluate });
    retarget.schedule();
    retarget.cancel();
    vi.advanceTimersByTime(1_000);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
