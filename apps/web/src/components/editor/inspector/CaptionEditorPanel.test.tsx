import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Project, TextClip } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { CaptionEditorPanel } from "./CaptionEditorPanel";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";

const TRACK_ID = "caption-track";

function caption(): TextClip {
  return {
    id: "caption-long",
    trackId: TRACK_ID,
    startTime: 10,
    duration: 7,
    text: "one two three four five six seven",
    style: {
      fontFamily: "Inter",
      fontSize: 48,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#ffffff",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    transform: {
      position: { x: 0.5, y: 0.8 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
    metadata: { captionSource: "srt" },
  };
}

function project(textClip: TextClip): Project {
  const empty = createEmptyProject("Single-line captions");
  return {
    ...empty,
    textClips: [textClip],
    timeline: {
      ...empty.timeline,
      duration: 20,
      tracks: [
        {
          id: TRACK_ID,
          type: "text",
          name: "Captions",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
}

describe("CaptionEditorPanel", () => {
  beforeEach(() => {
    useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
    useTimelineStore.setState({ playbackLockedReason: null });
    const textClip = caption();
    useEngineStore.getState().getTitleEngine()?.clear();
    useEngineStore.getState().getTitleEngine()?.loadTextClips([textClip]);
    useProjectStore.setState({ hasOpenProject: true, project: project(textClip) });
  });

  afterEach(() => {
    cleanup();
    useEngineStore.getState().getTitleEngine()?.clear();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("turns one long caption into sequential single-line clips", async () => {
    render(
      <CaptionEditorPanel
        maxWordsPerLine={5}
        onMaxWordsPerLineChange={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Make all 1 single-line" }),
    );

    await waitFor(() => {
      const clips = useEngineStore
        .getState()
        .getTitleEngine()
        ?.getAllTextClips()
        .sort((left, right) => left.startTime - right.startTime);
      expect(clips?.map((clip) => clip.text)).toEqual([
        "one two three four five",
        "six seven",
      ]);
      expect(clips?.map((clip) => [clip.startTime, clip.duration])).toEqual([
        [10, 5],
        [15, 2],
      ]);
      expect(clips?.every((clip) => !clip.text.includes("\n"))).toBe(true);
    });
  });

  it("replaces a batch without changing timing or styles, skips locks, and undoes once", async () => {
    const first = { ...caption(), text: "A edição\nno navegador" };
    const second = { ...caption(), id: "second", startTime: 17, text: "EDIÇÃO simples" };
    const locked = { ...caption(), id: "locked", trackId: "locked-track", text: "edição bloqueada" };
    const base = project(first);
    useProjectStore.getState().loadProject({ ...base, textClips: [first, second, locked], timeline: {
      ...base.timeline, tracks: [...base.timeline.tracks, { ...base.timeline.tracks[0], id: "locked-track", locked: true }],
    } });
    render(<CaptionEditorPanel maxWordsPerLine={5} onMaxWordsPerLineChange={() => undefined} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Find caption text" }), { target: { value: "edição" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace caption text with" }), { target: { value: "montagem" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace in all captions" }));
    expect(useProjectStore.getState().getTextClip(first.id)).toMatchObject({ text: "A montagem\nno navegador", style: first.style, startTime: first.startTime, duration: first.duration });
    expect(useProjectStore.getState().getTextClip(second.id)?.text).toBe("montagem simples");
    expect(useProjectStore.getState().getTextClip(locked.id)?.text).toBe("edição bloqueada");
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getTextClip(first.id)?.text).toBe(first.text);
    expect(useProjectStore.getState().getTextClip(second.id)?.text).toBe(second.text);
  });

  it("replaces only selected captions and leaves other drafts intact", () => {
    const first = { ...caption(), text: "Edit first" };
    const second = { ...caption(), id: "second", startTime: 18, text: "Edit second" };
    useProjectStore.getState().loadProject({ ...project(first), textClips: [first, second] });
    render(<CaptionEditorPanel maxWordsPerLine={5} onMaxWordsPerLineChange={() => undefined} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Caption 2 text" }), { target: { value: "Edit second draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Select caption 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find caption text" }), { target: { value: "Edit" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace caption text with" }), { target: { value: "Review" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace in selected captions" }));
    expect(useProjectStore.getState().getTextClip(first.id)?.text).toBe("Review first");
    expect(useProjectStore.getState().getTextClip(second.id)?.text).toBe("Edit second");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("textbox", { name: "Caption 2 text" })).toHaveValue("Edit second draft");
  });

  it("keeps the caption DOM bounded while search reaches later cues", () => {
    const clips = Array.from({ length: 150 }, (_, index) => ({ ...caption(), id: `caption-${index}`, startTime: index, text: index === 149 ? "Find this late cue" : `Caption ${index}` }));
    useProjectStore.getState().loadProject({ ...project(clips[0]), textClips: clips });
    render(<CaptionEditorPanel maxWordsPerLine={5} onMaxWordsPerLineChange={() => undefined} />);
    expect(screen.getAllByRole("textbox", { name: /^Caption \d+ text$/ })).toHaveLength(50);
    fireEvent.change(screen.getByRole("textbox", { name: "Find caption text" }), { target: { value: "late cue" } });
    expect(screen.getByRole("textbox", { name: "Caption 150 text" })).toHaveValue("Find this late cue");
    fireEvent.click(screen.getByRole("button", { name: "Go to caption 150" }));
    expect(useTimelineStore.getState().playheadPosition).toBe(149);
  });

  it("repairs legacy caption layers for export in one undoable move", async () => {
    const text = caption();
    const base = project(text);
    const videoTrack = { ...base.timeline.tracks[0], id: "video-track", name: "Video", type: "video" as const, clips: [{
      id: "video", mediaId: "source", trackId: "video-track", startTime: 0, duration: 2, inPoint: 0, outPoint: 2,
      effects: [], audioEffects: [], keyframes: [], volume: 1, transform: text.transform,
    }] };
    useProjectStore.getState().loadProject({ ...base, mediaLibrary: { items: [{
      id: "source", name: "source.mp4", type: "video", blob: null, fileHandle: null, waveformData: null, thumbnailUrl: null,
      metadata: { duration: 2, width: 640, height: 360, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
    }] }, timeline: { ...base.timeline, tracks: [videoTrack, ...base.timeline.tracks] } });
    const originalTracks = useProjectStore.getState().project.timeline.tracks;
    render(<CaptionEditorPanel maxWordsPerLine={5} onMaxWordsPerLineChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Bring caption tracks to front" }));
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks[0].id).toBe(TRACK_ID));
    expect(originalTracks.map((track) => track.id)).toEqual(["video-track", TRACK_ID]);
    expect(useProjectStore.getState().getTextClip(text.id)).toEqual(text);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().project.timeline.tracks.map((track) => track.id)).toEqual(["video-track", TRACK_ID]);
  });
});
