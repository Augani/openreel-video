import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackBridge } from "./playback-bridge";
import { useTimelineStore } from "../stores/timeline-store";

describe("PlaybackBridge scrubbing", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      playheadPosition: 1,
      isScrubbing: false,
      scrubPosition: null,
    });
  });

  it("moves the UI immediately and synchronizes the core once on release", () => {
    const controller = {
      startScrubbing: vi.fn(),
      scrubTo: vi.fn(async () => ({
        frame: null,
        renderTime: 0,
        fromCache: false,
        timedOut: false,
      })),
      endScrubbing: vi.fn(),
      seek: vi.fn(),
    };
    const bridge = new PlaybackBridge();
    Object.assign(bridge, { playbackController: controller });

    bridge.startScrubbing();
    bridge.scrubTo(4.25);

    expect(useTimelineStore.getState().playheadPosition).toBe(4.25);
    expect(controller.seek).not.toHaveBeenCalled();
    expect(controller.scrubTo).not.toHaveBeenCalled();

    bridge.endScrubbing();

    expect(controller.scrubTo).toHaveBeenCalledTimes(1);
    expect(controller.scrubTo).toHaveBeenCalledWith(4.25);
    expect(controller.endScrubbing).toHaveBeenCalledTimes(1);
    expect(useTimelineStore.getState().isScrubbing).toBe(false);
  });
});
