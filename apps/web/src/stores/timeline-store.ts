import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export const ZOOM_PRESETS = {
  MIN: 10,
  DEFAULT: 50,
  MAX: 500,
} as const;

export type PlaybackState = "stopped" | "playing" | "paused";

export interface TimelineState {
  playheadPosition: number;
  playbackState: PlaybackState;
  playbackRate: number;
  pixelsPerSecond: number;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  trackHeight: number;
  trackHeights: Record<string, number>;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  isScrubbing: boolean;
  scrubPosition: number | null;
  expandedTracks: Set<string>;
  expandedClipKeyframes: Set<string>;
  keyframeEditMode: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  togglePlayback: () => void;
  setPlaybackRate: (rate: number) => void;
  setPlayheadPosition: (position: number) => void;
  seekTo: (position: number) => void;
  seekRelative: (delta: number) => void;
  seekToStart: () => void;
  seekToEnd: (duration: number) => void;
  startScrubbing: (position: number) => void;
  updateScrubPosition: (position: number) => void;
  endScrubbing: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoom: (pixelsPerSecond: number) => void;
  zoomToFit: (duration: number) => void;
  resetZoom: () => void;
  setScrollX: (scrollX: number) => void;
  setScrollY: (scrollY: number) => void;
  scrollToPlayhead: () => void;
  setViewportDimensions: (width: number, height: number) => void;
  setTrackHeight: (height: number) => void;
  setTrackHeightById: (trackId: string, height: number) => void;
  getTrackHeight: (trackId: string) => number;
  setLoopEnabled: (enabled: boolean) => void;
  setLoopRange: (start: number, end: number) => void;
  timeToPixels: (time: number) => number;
  pixelsToTime: (pixels: number) => number;
  getVisibleTimeRange: () => { start: number; end: number };
  isTimeVisible: (time: number) => boolean;
  toggleTrackExpanded: (trackId: string) => void;
  setTrackExpanded: (trackId: string, expanded: boolean) => void;
  isTrackExpanded: (trackId: string) => boolean;
  toggleClipKeyframesExpanded: (clipId: string) => void;
  setClipKeyframesExpanded: (clipId: string, expanded: boolean) => void;
  isClipKeyframesExpanded: (clipId: string) => boolean;
  setKeyframeEditMode: (enabled: boolean) => void;
}

export const useTimelineStore = create<TimelineState>()(
  subscribeWithSelector((set, get) => ({
    playheadPosition: 0,
    playbackState: "stopped",
    playbackRate: 1.0,

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

    play: () => {
      set({ playbackState: "playing" });
    },

    pause: () => {
      set({ playbackState: "paused" });
    },

    stop: () => {
      set({
        playbackState: "stopped",
        playheadPosition: 0,
      });
    },

    togglePlayback: () => {
      const { playbackState } = get();
      if (playbackState === "playing") {
        set({ playbackState: "paused" });
      } else {
        set({ playbackState: "playing" });
      }
    },

    setPlaybackRate: (rate: number) => {
      set({ playbackRate: Math.max(0.1, Math.min(4.0, rate)) });
    },

    setPlayheadPosition: (position: number) => {
      set({ playheadPosition: Math.max(0, position) });
    },

    seekTo: (position: number) => {
      const clampedPosition = Math.max(0, position);
      set({ playheadPosition: clampedPosition });
    },

    seekRelative: (delta: number) => {
      const { playheadPosition } = get();
      const newPosition = Math.max(0, playheadPosition + delta);
      set({ playheadPosition: newPosition });
    },

    seekToStart: () => {
      set({ playheadPosition: 0 });
    },

    seekToEnd: (duration: number) => {
      set({ playheadPosition: duration });
    },

    startScrubbing: (position: number) => {
      set({
        isScrubbing: true,
        scrubPosition: position,
        playheadPosition: position,
      });
    },

    updateScrubPosition: (position: number) => {
      const { isScrubbing } = get();
      if (isScrubbing) {
        const clampedPosition = Math.max(0, position);
        set({
          scrubPosition: clampedPosition,
          playheadPosition: clampedPosition,
        });
      }
    },

    endScrubbing: () => {
      const { scrubPosition } = get();
      set({
        isScrubbing: false,
        scrubPosition: null,
        playheadPosition: scrubPosition ?? get().playheadPosition,
      });
    },

    zoomIn: () => {
      const { pixelsPerSecond } = get();
      // Scale zoom by 1.5x but never exceed max to prevent performance issues at extreme zoom
      const newZoom = Math.min(pixelsPerSecond * 1.5, ZOOM_PRESETS.MAX);
      set({ pixelsPerSecond: newZoom });
    },

    zoomOut: () => {
      const { pixelsPerSecond } = get();
      // Scale zoom down by 1.5x but never go below min to prevent blur at extreme zoom out
      const newZoom = Math.max(pixelsPerSecond / 1.5, ZOOM_PRESETS.MIN);
      set({ pixelsPerSecond: newZoom });
    },

    setZoom: (pixelsPerSecond: number) => {
      // Clamp zoom to valid range to ensure consistent rendering and prevent sub-pixel issues
      const clampedZoom = Math.max(
        ZOOM_PRESETS.MIN,
        Math.min(ZOOM_PRESETS.MAX, pixelsPerSecond),
      );
      set({ pixelsPerSecond: clampedZoom });
    },

    zoomToFit: (duration: number) => {
      const { viewportWidth } = get();
      if (duration > 0) {
        // Calculate zoom that fits entire timeline in viewport, leaving 100px margin for UI
        // Formula: pixels_per_second = available_width / duration_seconds
        const newZoom = Math.max(
          ZOOM_PRESETS.MIN,
          Math.min(ZOOM_PRESETS.MAX, (viewportWidth - 100) / duration),
        );
        set({
          pixelsPerSecond: newZoom,
          scrollX: 0, // Reset scroll to show beginning of timeline
        });
      }
    },

    resetZoom: () => {
      set({
        pixelsPerSecond: ZOOM_PRESETS.DEFAULT,
        scrollX: 0,
      });
    },

    setScrollX: (scrollX: number) => {
      set({ scrollX: Math.max(0, scrollX) });
    },

    setScrollY: (scrollY: number) => {
      set({ scrollY: Math.max(0, scrollY) });
    },

    scrollToPlayhead: () => {
      const { playheadPosition, pixelsPerSecond, viewportWidth, scrollX } =
        get();
      // Convert playhead time to pixel position using current zoom level
      const playheadPixels = playheadPosition * pixelsPerSecond;

      // Only scroll if playhead is outside visible viewport range
      // Check: playheadPixels < scrollX (left boundary) OR playheadPixels > scrollX + viewportWidth (right boundary)
      if (
        playheadPixels < scrollX ||
        playheadPixels > scrollX + viewportWidth
      ) {
        // Center playhead in viewport by placing it at 50% width from left edge
        const newScrollX = Math.max(0, playheadPixels - viewportWidth / 2);
        set({ scrollX: newScrollX });
      }
    },

    setViewportDimensions: (width: number, height: number) => {
      set({
        viewportWidth: width,
        viewportHeight: height,
      });
    },

    setTrackHeight: (height: number) => {
      // Update default track height within valid bounds (40px min for usability, 200px max for space)
      set({ trackHeight: Math.max(40, Math.min(200, height)) });
    },

    setTrackHeightById: (trackId: string, height: number) => {
      // Clamp individual track height to prevent extreme values affecting layout calculations
      const clampedHeight = Math.max(40, Math.min(200, height));
      // Use spread operator on trackHeights Map to trigger reactivity in Zustand
      set((state) => ({
        trackHeights: { ...state.trackHeights, [trackId]: clampedHeight },
      }));
    },

    getTrackHeight: (trackId: string) => {
      const { trackHeights, trackHeight } = get();
      // Fallback to default trackHeight if track-specific height not set (nullish coalescing)
      return trackHeights[trackId] ?? trackHeight;
    },

    setLoopEnabled: (enabled: boolean) => {
      set({ loopEnabled: enabled });
    },

    setLoopRange: (start: number, end: number) => {
      if (start < end) {
        set({
          loopStart: Math.max(0, start),
          loopEnd: end,
        });
      }
    },

    timeToPixels: (time: number) => {
      const { pixelsPerSecond } = get();
      // Convert seconds to pixel distance: pixels = time * pixels_per_second
      return time * pixelsPerSecond;
    },

    pixelsToTime: (pixels: number) => {
      const { pixelsPerSecond } = get();
      // Convert pixel distance to seconds: time = pixels / pixels_per_second
      return pixels / pixelsPerSecond;
    },

    getVisibleTimeRange: () => {
      const { scrollX, viewportWidth, pixelsPerSecond } = get();
      // Calculate which time span is visible in the current viewport
      // start: leftmost pixel (scrollX) converted to time
      // end: rightmost pixel (scrollX + viewportWidth) converted to time
      return {
        start: scrollX / pixelsPerSecond,
        end: (scrollX + viewportWidth) / pixelsPerSecond,
      };
    },

    isTimeVisible: (time: number) => {
      const { start, end } = get().getVisibleTimeRange();
      return time >= start && time <= end;
    },

    toggleTrackExpanded: (trackId: string) => {
      set((state) => {
        const newSet = new Set(state.expandedTracks);
        if (newSet.has(trackId)) {
          newSet.delete(trackId);
        } else {
          newSet.add(trackId);
        }
        return { expandedTracks: newSet };
      });
    },

    setTrackExpanded: (trackId: string, expanded: boolean) => {
      set((state) => {
        const newSet = new Set(state.expandedTracks);
        if (expanded) {
          newSet.add(trackId);
        } else {
          newSet.delete(trackId);
        }
        return { expandedTracks: newSet };
      });
    },

    isTrackExpanded: (trackId: string) => {
      return get().expandedTracks.has(trackId);
    },

    toggleClipKeyframesExpanded: (clipId: string) => {
      set((state) => {
        const newSet = new Set(state.expandedClipKeyframes);
        if (newSet.has(clipId)) {
          newSet.delete(clipId);
        } else {
          newSet.add(clipId);
        }
        return { expandedClipKeyframes: newSet };
      });
    },

    setClipKeyframesExpanded: (clipId: string, expanded: boolean) => {
      set((state) => {
        const newSet = new Set(state.expandedClipKeyframes);
        if (expanded) {
          newSet.add(clipId);
        } else {
          newSet.delete(clipId);
        }
        return { expandedClipKeyframes: newSet };
      });
    },

    isClipKeyframesExpanded: (clipId: string) => {
      return get().expandedClipKeyframes.has(clipId);
    },

    setKeyframeEditMode: (enabled: boolean) => {
      set({ keyframeEditMode: enabled });
    },
  })),
);
