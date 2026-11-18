import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRAME_STALL_MS, clearPlaybackStalls, getPlaybackStalls, startFrameWatchdog } from "./playback-watchdog";

describe("startFrameWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPlaybackStalls();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = () => {
    let processing = false;
    let startedAt = 0;
    let stage = "idle";
    let clock = 0;
    const recover = vi.fn(() => {
      processing = false;
    });
    const stop = startFrameWatchdog({
      isProcessing: () => processing,
      frameStartedAt: () => startedAt,
      stage: () => stage,
      playhead: () => 17.13,
      recover,
      now: () => clock,
    });
    return {
      recover,
      stop,
      begin(s: string) {
        processing = true;
        startedAt = clock;
        stage = s;
      },
      advance(ms: number) {
        clock += ms;
        vi.advanceTimersByTime(ms);
      },
    };
  };

  it("leaves frames that finish in time alone", () => {
    const w = make();
    w.begin("decode");
    w.advance(FRAME_STALL_MS - 1000);
    expect(w.recover).not.toHaveBeenCalled();
    w.stop();
  });

  it("recovers a frame that never finishes and records where it was waiting", () => {
    const w = make();
    w.begin("init-resources");
    w.advance(FRAME_STALL_MS + 1000);
    expect(w.recover).toHaveBeenCalledTimes(1);
    expect(getPlaybackStalls()).toEqual([{ stage: "init-resources", stalledMs: expect.any(Number), atPlayhead: 17.13 }]);
    expect(getPlaybackStalls()[0].stalledMs).toBeGreaterThanOrEqual(FRAME_STALL_MS);
    w.stop();
  });

  it("does not fire while idle and stops when asked", () => {
    const w = make();
    w.advance(FRAME_STALL_MS * 3);
    expect(w.recover).not.toHaveBeenCalled();
    w.begin("decode");
    w.stop();
    w.advance(FRAME_STALL_MS * 2);
    expect(w.recover).not.toHaveBeenCalled();
  });
});
