import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { TrackHeader } from "./TrackHeader";
import { useTimelineStore } from "../../../stores/timeline-store";

function audioTrack(id: string, name: string): Track {
  return {
    id,
    type: "audio",
    name,
    clips: [
      {
        id: `${id}-clip`,
        mediaId: `${id}-media`,
        trackId: id,
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        effects: [],
        audioEffects: [],
        transform: {
          position: { x: 0.5, y: 0.5 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        volume: 1,
        keyframes: [],
      },
    ],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}

const noop = () => undefined;

function header(track: Track) {
  return (
    <TrackHeader
      track={track}
      index={0}
      onDragStart={noop}
      onDragOver={noop}
      onDrop={noop}
      onDragEnd={noop}
    />
  );
}

function renderHeader(track: Track) {
  return render(header(track));
}

describe("TrackHeader audio controls", () => {
  const originalWidth = window.innerWidth;
  beforeEach(() => {
    useTimelineStore.setState({ trackHeight: 62, trackHeights: {} });
    // Direct controls belong to the desktop layout; JSDOM defaults to 1024px.
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    const project = createEmptyProject("Audio controls");
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...project,
        mediaLibrary: {
          items: ["dialogue", "music"].map((id) => ({
            id: `${id}-media`,
            name: id,
            type: "audio" as const,
            fileHandle: null,
            blob: null,
            metadata: {
              duration: 5,
              width: 0,
              height: 0,
              frameRate: 0,
              codec: "aac",
              sampleRate: 48_000,
              channels: 2,
              fileSize: 1,
            },
            thumbnailUrl: null,
            waveformData: null,
          })),
        },
        timeline: {
          ...project.timeline,
          tracks: [audioTrack("dialogue", "Dialogue"), audioTrack("music", "Music")],
        },
      },
    });
    useProjectStore.getState().actionExecutor.getHistory().clear();
  });


  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("exposes solo directly in the timeline and persists it undoably", async () => {
    renderHeader(useProjectStore.getState().project.timeline.tracks[0]);

    expect(screen.getByText("Dialogue")).toHaveClass("cursor-grab");

    fireEvent.click(screen.getByRole("button", { name: "Solo Dialogue" }));

    await waitFor(() => {
      expect(useProjectStore.getState().project.timeline.tracks[0]?.solo).toBe(true);
      expect(useProjectStore.getState().actionExecutor.getHistory().canUndo()).toBe(true);
    });
  });

  it.each([390, 820])("retains undoable mute and solo in the compact menu at %ipx", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({
      matches: query === "(max-width: 1366px) and (hover: none) and (pointer: coarse)", media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true,
    }));
    function LiveHeader() {
      const track = useProjectStore((state) => state.project.timeline.tracks[0]);
      return header(track);
    }
    render(<LiveHeader />);
    expect(screen.queryByRole("button", { name: "Solo Dialogue" })).toBeNull();
    for (const [label, stateKey] of [["Mute track", "muted"], ["Solo track", "solo"]] as const) {
      fireEvent.keyDown(screen.getByRole("button", { name: "Options for Dialogue" }), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: label }));
      await waitFor(() => {
        expect(useProjectStore.getState().project.timeline.tracks[0][stateKey]).toBe(true);
        expect(useProjectStore.getState().actionExecutor.getHistory().canUndo()).toBe(true);
      });
      await act(async () => { await useProjectStore.getState().undo(); });
      expect(useProjectStore.getState().project.timeline.tracks[0][stateKey]).toBe(false);
    }
  });
  it("groups two previously ungrouped tracks through the context menu and restores them with one Undo", async () => {
    const view = renderHeader(useProjectStore.getState().project.timeline.tracks[0]);
    fireEvent.contextMenu(view.container.querySelector("[data-timeline-track-header]")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Group with Music" }));
    await waitFor(() => {
      const [first, second] = useProjectStore.getState().project.timeline.tracks;
      expect(first.groupId).toBeTruthy();
      expect(first.groupId).toBe(second.groupId);
    });
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().project.timeline.tracks.map(track => track.groupId)).toEqual([undefined, undefined]);
  });

  it("cancels rename with Escape and commits a changed name once despite a following blur", async () => {
    const view = renderHeader(useProjectStore.getState().project.timeline.tracks[0]);
    fireEvent.doubleClick(screen.getByText("Dialogue"));
    let input = screen.getByRole("textbox", { name: "Track name" });
    fireEvent.change(input, { target: { value: "Canceled name" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(useProjectStore.getState().project.timeline.tracks[0].name).toBe("Dialogue");
    expect(useProjectStore.getState().canUndo()).toBe(false);
    fireEvent.doubleClick(screen.getByText("Dialogue"));
    input = screen.getByRole("textbox", { name: "Track name" });
    fireEvent.change(input, { target: { value: "  Voice  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0].name).toBe("Voice"));
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().project.timeline.tracks[0].name).toBe("Dialogue");
    expect(useProjectStore.getState().canUndo()).toBe(false);
    expect(view.container.querySelector('[aria-label="Track name"]')).toBeNull();
  });

  it.each(["video", "text", "graphics"] as const)("preserves embedded audio controls and Undo in a %s track context menu", async type => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: [{ ...project.timeline.tracks[0], type, name: "Main" }, project.timeline.tracks[1]] }, mediaLibrary: { items: project.mediaLibrary.items.map((item, index) => index === 0 ? { ...item, type: "video", metadata: { ...item.metadata, hasAudio: true, hasVideo: true } } : item) } } });
    function LiveHeader() { return header(useProjectStore(state => state.project.timeline.tracks[0])); }
    const view = render(<LiveHeader />);
    expect(screen.getByRole("button", { name: "Hide track" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mute Main" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Solo Main" })).toBeNull();
    for (const [label, key] of [["Mute Main", "muted"], ["Solo Main", "solo"]] as const) {
      fireEvent.keyDown(screen.getByRole("group", { name: "Main track" }), { key: "F10", shiftKey: true });
      const control = screen.getByRole("menuitemcheckbox", { name: label });
      expect(control).toHaveAttribute("aria-checked", "false");
      fireEvent.click(control);
      await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0][key]).toBe(true));
      await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
      expect(useProjectStore.getState().project.timeline.tracks[0][key]).toBe(false);
      await act(async () => { expect((await useProjectStore.getState().redo()).success).toBe(true); });
      expect(useProjectStore.getState().project.timeline.tracks[0][key]).toBe(true);
      await act(async () => { await useProjectStore.getState().undo(); });
    }
    expect(view.container.querySelector("[data-timeline-track-header]")).toHaveAttribute("tabindex", "0");
  });

});
