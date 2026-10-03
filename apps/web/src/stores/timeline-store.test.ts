import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TIMELINE_WORKSPACE_STORAGE_KEY,
  useTimelineStore,
  ZOOM_PRESETS,
} from "./timeline-store";

describe("TimelineStore playback locking", () => {
  beforeEach(() => {
    localStorage.removeItem(TIMELINE_WORKSPACE_STORAGE_KEY);
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

  it("persists global and per-track density without serializing transient timeline state", () => {
    const store = useTimelineStore.getState();
    store.setTrackHeight(64);
    store.setTrackHeightById("dialogue", 112);

    const persisted = JSON.parse(
      localStorage.getItem(TIMELINE_WORKSPACE_STORAGE_KEY) ?? "{}",
    ) as { state?: Record<string, unknown> };
    expect(persisted.state).toEqual({
      trackHeight: 64,
      trackHeights: { dialogue: 112 },
    });
    expect(persisted.state).not.toHaveProperty("playheadPosition");
    expect(persisted.state).not.toHaveProperty("selectedClipIds");
  });

  it("does not serialize or write workspace preferences during playback and scrubbing", () => {
    const store = useTimelineStore.getState();
    store.setTrackHeightById("dialogue", 112);
    const writes = vi.spyOn(localStorage, "setItem");
    const serializations = vi.spyOn(JSON, "stringify");

    try {
      store.play();
      for (let frame = 1; frame <= 120; frame++) {
        store.setPlayheadPosition(frame / 60);
      }
      store.pause();
      store.startScrubbing(3);
      store.updateScrubPosition(4);
      store.endScrubbing();
      store.setScrollX(200);
      store.setViewportDimensions(1200, 400);

      expect(writes).not.toHaveBeenCalled();
      expect(serializations).not.toHaveBeenCalled();

      store.setTrackHeightById("dialogue", 120);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(serializations).toHaveBeenCalledTimes(1);
      expect(JSON.parse(localStorage.getItem(TIMELINE_WORKSPACE_STORAGE_KEY) ?? "{}").state)
        .toEqual({ trackHeight: 80, trackHeights: { dialogue: 120 } });
    } finally {
      writes.mockRestore();
      serializations.mockRestore();
    }
  });

  it("writes density preferences again after persisted workspace data is cleared", () => {
    const store = useTimelineStore.getState();
    store.setTrackHeight(64);
    useTimelineStore.persist.clearStorage();
    expect(localStorage.getItem(TIMELINE_WORKSPACE_STORAGE_KEY)).toBeNull();

    store.setTrackHeight(64);
    expect(JSON.parse(localStorage.getItem(TIMELINE_WORKSPACE_STORAGE_KEY) ?? "{}").state)
      .toEqual({ trackHeight: 64, trackHeights: {} });
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
