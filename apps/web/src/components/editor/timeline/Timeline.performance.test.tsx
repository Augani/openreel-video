import { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { ClipContextMenu } from "./ClipContextMenu";
import { ClipComponent } from "./ClipComponent";
import { openContextMenu } from "../../../test/open-context-menu";

const transform = {
  position: { x: 0.5, y: 0.5 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};
const clip: Clip = {
  id: "video", mediaId: "video-media", trackId: "track", startTime: 0,
  duration: 10, inPoint: 0, outPoint: 10, effects: [], audioEffects: [],
  keyframes: [], volume: 1, transform,
};
const track: Track = {
  id: "track", name: "Video", type: "video", clips: [clip], transitions: [],
  locked: false, hidden: false, muted: false, solo: false,
};
const noop = () => undefined;

describe("timeline playback rendering", () => {
  beforeEach(() => {
    const project = createEmptyProject("Playback rendering");
    useProjectStore.setState({
      hasOpenProject: true,
      project: { ...project, timeline: { ...project.timeline, tracks: [track] } },
      clipboard: [], copiedEffects: [], error: null,
    });
    useTimelineStore.setState({
      playheadPosition: 1, playbackState: "stopped", trackHeight: 64,
      trackHeights: {}, expandedTracks: new Set(), viewportWidth: 1000,
    });
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("updates the split menu at clip boundaries and splits at the latest playback time", async () => {
    const split = vi.spyOn(useProjectStore.getState(), "splitClip")
      .mockResolvedValue({ success: true });
    const renders = vi.fn();
    openContextMenu(<Profiler id="menu" onRender={renders}><ClipContextMenu clip={clip} track={track} /></Profiler>);
    renders.mockClear();
    act(() => useTimelineStore.getState().setPlayheadPosition(4));
    expect(renders).not.toHaveBeenCalled();
    act(() => useTimelineStore.getState().setPlayheadPosition(11));
    expect(renders).toHaveBeenCalled();
    renders.mockClear();
    act(() => useTimelineStore.getState().setPlayheadPosition(12));
    expect(renders).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Split at Playhead" })).toHaveAttribute("data-disabled");
    act(() => useTimelineStore.getState().setPlayheadPosition(4));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Split at Playhead" })));
    expect(split).toHaveBeenCalledWith(clip.id, 4);
  });

  it.each(["video", "audio"] as const)("limits %s decorations to the viewport on an hour-long clip", (type) => {
    const longClip = { ...clip, duration: 3600, outPoint: 3600 };
    const longTrack = { ...track, type, clips: [longClip] };
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: { ...project.timeline, tracks: [longTrack] },
        mediaLibrary: {
          items: [{
            id: clip.mediaId, name: "Long recording", type, fileHandle: null,
            blob: null, thumbnailUrl: "blob:thumbnail", waveformData: new Float32Array(3600),
            metadata: {
              duration: 3600, width: 1920, height: 1080, frameRate: 30,
              codec: "h264", sampleRate: 48_000, channels: 2, fileSize: 1,
            },
          }],
        },
      },
    });
    const props = {
      clip: longClip, track: longTrack, allTracks: [longTrack], pixelsPerSecond: 500,
      scrollX: 500_000, viewportWidth: 1000, isSelected: false,
      trackHeights: new Map([[track.id, 64]]), timelineRef: { current: null },
      onSelect: noop, onMoveClip: noop, onSnapIndicator: noop,
    };
    const view = render(<ClipComponent {...props} />);
    const decorations = () => type === "video"
      ? view.container.querySelectorAll(".bg-cover")
      : view.container.querySelectorAll('svg[height="28"] rect');
    // Waveform bars use the reference's 3px spacing, bounded by the visible
    // 1000px plus 120px overscan on each side, independently of clip length.
    const maximum = type === "video" ? 22 : Math.ceil((1000 + 2 * 120) / 3) + 2;
    expect(decorations().length).toBeGreaterThan(0);
    expect(decorations().length).toBeLessThanOrEqual(maximum);

    view.rerender(<ClipComponent {...props} scrollX={0} />);
    expect(decorations().length).toBeGreaterThan(0);
    expect(decorations().length).toBeLessThanOrEqual(maximum);
  });

  it("renders legacy video-backed audio clips as waveforms and hides Separate Audio", () => {
    const audioTrack = { ...track, type: "audio" as const };
    const media = {
      id: clip.mediaId, name: "Recording.mp4", type: "video" as const,
      fileHandle: null, blob: null, thumbnailUrl: "blob:thumbnail",
      waveformData: new Float32Array([0.2, 0.5, 0.8]),
      metadata: { duration: 10, width: 1920, height: 1080, frameRate: 30,
        codec: "h264", sampleRate: 48_000, channels: 2, fileSize: 1 },
    };
    const project = useProjectStore.getState().project;
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [media] },
      timeline: { ...project.timeline, tracks: [audioTrack] } } });
    const view = render(<ClipComponent clip={clip} track={audioTrack} allTracks={[audioTrack]}
      pixelsPerSecond={50} scrollX={0} viewportWidth={1000} isSelected={false}
      trackHeights={new Map([[track.id, 64]])} timelineRef={{ current: null }}
      onSelect={noop} onMoveClip={noop} onSnapIndicator={noop} />);
    expect(view.container.querySelectorAll(".bg-cover")).toHaveLength(0);
    expect(view.container.querySelectorAll('svg[height="28"] rect').length).toBeGreaterThan(0);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Select clip/ }));
    expect(screen.queryByRole("menuitem", { name: "Separate Audio" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Copy Audio Effects" })).toBeInTheDocument();
  });

  it("preserves selected clip offsets across drag updates and leaves locked clips alone", async () => {
    const frames = new Map<number, Parameters<typeof window.requestAnimationFrame>[0]>();
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 1000, 500));
    const primary = { ...clip, duration: 1, outPoint: 1 };
    const companion = { ...primary, id: "companion", startTime: 3 };
    const lockedClip = { ...primary, id: "locked", trackId: "locked-track", startTime: 7 };
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [
            { ...track, clips: [primary, companion] },
            { ...track, id: "locked-track", locked: true, clips: [lockedClip] },
          ],
        },
      },
    });
    useUIStore.getState().selectMultiple([
      { type: "clip", id: primary.id, trackId: track.id },
      { type: "clip", id: companion.id, trackId: track.id },
      { type: "clip", id: lockedClip.id, trackId: lockedClip.trackId },
    ]);
    const snapSettings = useUIStore.getState().snapSettings;
    useUIStore.setState({ snapSettings: { ...snapSettings, enabled: false } });
    const moves = vi.fn((id: string, startTime: number) => {
      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            tracks: state.project.timeline.tracks.map((candidate) => ({
              ...candidate,
              clips: candidate.clips.map((item) => item.id === id ? { ...item, startTime } : item),
            })),
          },
        },
      }));
    });
    const viewport = { current: null as HTMLDivElement | null };
    const heights = new Map([[track.id, 64], [lockedClip.trackId, 64]]);
    function DragHarness() {
      const tracks = useProjectStore((state) => state.project.timeline.tracks);
      return (
        <div ref={(element) => { viewport.current = element; }}>
          <ClipComponent clip={tracks[0].clips[0]} track={tracks[0]} allTracks={tracks}
            pixelsPerSecond={50} scrollX={0} viewportWidth={1000} isSelected
            trackHeights={heights} timelineRef={viewport} onSelect={noop}
            onMoveClip={moves} onSnapIndicator={noop} />
        </div>
      );
    }
    const flushFrame = () => act(() => {
      const callbacks = Array.from(frames.values());
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    });
    const starts = () => useProjectStore.getState().project.timeline.tracks
      .flatMap((candidate) => candidate.clips.map((item) => item.startTime));
    const view = render(<DragHarness />);

    try {
      fireEvent.mouseDown(view.getByRole("button", { name: /Select clip video/ }),
        { button: 0, clientX: 0, clientY: 20 });
      fireEvent.mouseMove(window, { clientX: 10, clientY: 20 });
      fireEvent.mouseMove(window, { clientX: 50, clientY: 20 });
      // The activating move's commit waits one extra frame (see ClipComponent: no two timeline renders in one frame).
      flushFrame();
      expect(starts()).toEqual([0, 3, 7]);
      flushFrame();
      expect(starts()).toEqual([1, 4, 7]);

      fireEvent.mouseMove(window, { clientX: 100, clientY: 20 });
      flushFrame();
      expect(starts()).toEqual([2, 5, 7]);
      expect(moves).not.toHaveBeenCalledWith(lockedClip.id, expect.anything());

      await act(async () => { fireEvent.mouseUp(window); });
      const finalMoveCount = moves.mock.calls.length;
      fireEvent.mouseMove(window, { clientX: 150, clientY: 20 });
      flushFrame();
      expect(moves).toHaveBeenCalledTimes(finalMoveCount);
      expect(frames.size).toBe(0);
    } finally {
      view.unmount();
      useUIStore.setState({ snapSettings });
    }
  });
});
