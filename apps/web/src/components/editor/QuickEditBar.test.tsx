import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";
import { QuickEditBar } from "./QuickEditBar";

const clipId = "quick-clip";
const trackId = "quick-track";
function seed(type: "video" | "audio" = "video"): Project {
  const empty = createEmptyProject("Quick edit test");
  const project: Project = {
    ...empty,
    settings: { ...empty.settings, frameRate: 24 },
    mediaLibrary: { items: [{ id: "quick-media", name: "Source", type,
      blob: new Blob(["fixture"]), fileHandle: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 4, width: type === "video" ? 1920 : 0, height: type === "video" ? 1080 : 0,
        frameRate: 24, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 7 } }] },
    timeline: { ...empty.timeline, duration: 4, tracks: [{ id: trackId, name: "Source", type,
      locked: false, hidden: false, muted: false, solo: false, transitions: [], clips: [{
        id: clipId, mediaId: "quick-media", trackId, startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
        effects: [], audioEffects: [], volume: 1, keyframes: [],
        transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
          anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
      }] }] },
  };
  useProjectStore.getState().actionHistory.clear();
  useProjectStore.setState({ project, hasOpenProject: true, clipUndoStack: [], clipRedoStack: [],
    templateUndoStack: [], templateRedoStack: [] });
  useTimelineStore.setState({ playheadPosition: 2, playbackState: "paused", playbackLockedReason: null });
  useUIStore.setState({ exportState: { isExporting: false, progress: 0, phase: "" }, effectApplicationClipId: null });
  useUIStore.getState().select({ type: "clip", id: clipId, trackId });
  return project;
}

describe("QuickEditBar", () => {
  beforeEach(() => { seed(); });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useInspectorNavigationStore.getState().clearRequest();
    useUIStore.getState().clearSelection();
    useUIStore.getState().closeModal();
    useTimelineStore.setState({ playbackLockedReason: null });
    useProjectStore.getState().actionHistory.clear();
  });
  const show = () => render(<QuickEditBar clipId={clipId} onCleanAudio={vi.fn()} isCleaningAudio={false} />);

  it("splits through the real edit history and undoes in one step", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Split here" }));
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(2));
    expect(useProjectStore.getState().project.timeline.tracks[0].clips.map(clip => clip.duration)).toEqual([2, 2]);
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(1);
    expect(useProjectStore.getState().getClip(clipId)?.duration).toBe(4);
  });

  it.each(["Trim start", "Trim end"])("%s uses the playhead and remains undoable", async label => {
    show();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(useProjectStore.getState().getClip(clipId)?.duration).toBe(2));
    expect(useProjectStore.getState().getClip(clipId)?.startTime).toBe(label === "Trim start" ? 2 : 0);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getClip(clipId)?.duration).toBe(4);
  });

  it("trims linked captions with the media and restores both in one undo", async () => {
    const store = useProjectStore.getState();
    const project = store.project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: [...project.timeline.tracks, { id: "captions", name: "Captions", type: "text", clips: [],
        transitions: [], locked: false, hidden: false, muted: false, solo: false }] } } });
    const caption = useProjectStore.getState().createTextClip("captions", 1, "Linked words", 2, undefined,
      { captionSourceClipId: clipId });
    expect(caption).not.toBeNull();
    useProjectStore.getState().actionHistory.clear();
    show();
    fireEvent.click(screen.getByRole("button", { name: "Trim start" }));
    await waitFor(() => expect(useProjectStore.getState().getClip(clipId)?.duration).toBe(2));
    expect(useProjectStore.getState().getTextClip(caption!.id)).toMatchObject({ startTime: 2, duration: 1 });
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().getClip(clipId)?.duration).toBe(4);
    expect(useProjectStore.getState().getTextClip(caption!.id)).toMatchObject({ startTime: 1, duration: 2 });
  });

  it("disables edits on locked tracks and during export", () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: project.timeline.tracks.map(track => ({ ...track, locked: true })) } } });
    show();
    expect(screen.getByRole("button", { name: "Split here" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clean audio" })).toBeDisabled();
    act(() => useUIStore.getState().setExportState({ isExporting: true, progress: 0, phase: "encoding" }));
    expect(screen.getByRole("button", { name: "Export video" })).toBeDisabled();
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("checks the current selection before dispatching a stale click", () => {
    const split = vi.spyOn(useProjectStore.getState(), "splitClip");
    show();
    act(() => useUIStore.getState().clearSelection());
    fireEvent.click(screen.getByRole("button", { name: "Split here" }));
    expect(split).not.toHaveBeenCalled();
  });

  it("prevents duplicate edits while a command is pending", async () => {
    let complete!: (value: { success: boolean }) => void;
    const split = vi.fn(() => new Promise<{ success: boolean }>(resolve => { complete = resolve; }));
    const original = useProjectStore.getState().splitClip;
    useProjectStore.setState({ splitClip: split });
    try {
      show();
      fireEvent.click(screen.getByRole("button", { name: "Split here" }));
      fireEvent.click(screen.getByRole("button", { name: "Split here" }));
      expect(split).toHaveBeenCalledTimes(1);
      await act(async () => { complete({ success: true }); });
    } finally { useProjectStore.setState({ splitClip: original }); }
  });

  it("takes audio-only clips to captions and opens export", () => {
    seed("audio");
    show();
    expect(screen.queryByRole("button", { name: "Reframe" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add captions" }));
    expect(useInspectorNavigationStore.getState().request).toMatchObject({ sectionId: "auto-captions", clipId });
    fireEvent.click(screen.getByRole("button", { name: "Export video" }));
    expect(useUIStore.getState().activeModal).toBe("export");
  });

  it("keeps unavailable media from starting captions or cleanup", () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({ project: { ...project, mediaLibrary: {
      items: project.mediaLibrary.items.map(item => ({ ...item, blob: null, isPlaceholder: true })) } } });
    show();
    expect(screen.getByRole("button", { name: "Add captions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clean audio" })).toBeDisabled();
  });
});
