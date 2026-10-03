import { Profiler } from "react";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, TextClip, Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { TrackLane } from "./TrackLane";
import { TrackHeader } from "./TrackHeader";
import { useClipContextMenuItems } from "./ClipContextMenu";
import { ClipComponent } from "./ClipComponent";

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
const caption: TextClip = {
  id: "caption", trackId: track.id, startTime: 0, duration: 10, text: "Caption",
  transform, keyframes: [],
  style: {
    fontFamily: "Inter", fontSize: 48, fontWeight: "bold", fontStyle: "normal",
    color: "#fff", textAlign: "center", verticalAlign: "middle",
    lineHeight: 1.2, letterSpacing: 0,
  },
};
const noop = () => undefined;

describe("timeline playback rendering", () => {
  beforeEach(() => {
    const project = createEmptyProject("Playback rendering");
    useProjectStore.setState({
      hasOpenProject: true,
      project: { ...project, timeline: { ...project.timeline, tracks: [track] } },
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

  it("keeps lanes, media clips, captions, and headers idle between clip boundaries", () => {
    const commits = vi.fn();
    render(
      <Profiler id="timeline" onRender={commits}>
        <TrackHeader track={track} index={0} onDragStart={noop}
          onDragOver={noop} onDrop={noop} onDragEnd={noop} />
        <TrackLane track={track} allTracks={[track]} pixelsPerSecond={50}
          selectedClipIds={[]} textClips={[caption]} shapeClips={[]}
          trackHeights={new Map([[track.id, 64]])} timelineRef={{ current: null }}
          onSelectClip={noop} onDropMedia={noop} onMoveClip={noop}
          onMoveTextClip={noop} onSnapIndicator={noop} onTrimTextClip={noop}
          onTrimShapeClip={noop} scrollX={0} trackHeight={64}
          onResizeTrack={noop} onSelectTransition={noop} />
      </Profiler>,
    );
    commits.mockClear();

    // Separate acts model distinct frames rather than a batched state update.
    for (let frame = 1; frame <= 60; frame++) {
      act(() => useTimelineStore.getState().setPlayheadPosition(1 + frame / 60));
    }
    expect(commits).not.toHaveBeenCalled();

    act(() => useTimelineStore.getState().setTrackHeightById(track.id, 120));
    expect(commits).toHaveBeenCalled();
  });

  it("updates the split menu at clip boundaries and splits at the latest playback time", async () => {
    const split = vi.spyOn(useProjectStore.getState(), "splitClip")
      .mockResolvedValue({ success: true });
    const renders = vi.fn();
    const { result } = renderHook(() => {
      renders();
      return useClipContextMenuItems({ clip, track });
    });
    const splitAction = () => result.current.find(
      (item) => "label" in item && item.label === "Split at Playhead",
    );
    renders.mockClear();

    act(() => useTimelineStore.getState().setPlayheadPosition(4));
    expect(renders).not.toHaveBeenCalled();
    const item = splitAction();
    if (!item || !("onClick" in item)) throw new Error("Missing split action");
    await act(async () => item.onClick?.());
    expect(split).toHaveBeenCalledWith(clip.id, 4);

    act(() => useTimelineStore.getState().setPlayheadPosition(11));
    expect(renders).toHaveBeenCalledTimes(1);
    expect(splitAction()).toHaveProperty("isDisabled", true);
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
    const maximum = type === "video" ? 22 : 208;
    expect(decorations().length).toBeGreaterThan(0);
    expect(decorations().length).toBeLessThanOrEqual(maximum);

    view.rerender(<ClipComponent {...props} scrollX={0} />);
    expect(decorations().length).toBeGreaterThan(0);
    expect(decorations().length).toBeLessThanOrEqual(maximum);
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
