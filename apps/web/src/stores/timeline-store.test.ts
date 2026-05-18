import { beforeEach, describe, expect, it } from "vitest";
import { useTimelineStore, ZOOM_PRESETS } from "./timeline-store";

describe("TimelineStore playback locking", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      playheadPosition: 0,
      playbackState: "stopped",
      playbackLockedReason: null,
      playbackRate: 1,
      pixelsPerSecond: ZOOM_PRESETS.DEFAULT,
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 800,
      viewportHeight: 400,
      trackHeight: 80,
      trackHeights: {},
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 0,
      isScrubbing: false,
      scrubPosition: null,
      expandedTracks: new Set<string>(),
      expandedClipKeyframes: new Set<string>(),
      keyframeEditMode: false,
    });
  });

  it("blocks play and toggle while locked", () => {
    const store = useTimelineStore.getState();

    store.lockPlayback("Applying auto color");
    store.play();
    store.togglePlayback();

    const state = useTimelineStore.getState();
    expect(state.playbackState).toBe("stopped");
    expect(state.playbackLockedReason).toBe("Applying auto color");
  });

  it("allows playback again after unlocking", () => {
    const store = useTimelineStore.getState();

    store.lockPlayback("Applying auto color");
    store.unlockPlayback();
    store.togglePlayback();

    const state = useTimelineStore.getState();
    expect(state.playbackLockedReason).toBeNull();
    expect(state.playbackState).toBe("playing");
  });
});