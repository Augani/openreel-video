import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useInspectorNavigationStore } from "../../../stores/inspector-navigation-store";
import { MobileEditorTools } from "./MobileEditorTools";

function seed(linked = false) {
  const empty = createEmptyProject("Mobile tools");
  const clip = { id: "video", trackId: "main", mediaId: "media", startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
    volume: 1, effects: [], audioEffects: [], keyframes: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: .5, y: .5 }, opacity: 1 } };
  const flags = { locked: false, hidden: false, muted: false, solo: false, transitions: [] };
  const project: Project = { ...empty,
    mediaLibrary: { items: [{ id: "media", name: "Interview.mp4", type: "video", fileHandle: null, blob: new Blob(["fixture"]), thumbnailUrl: null, waveformData: null,
      metadata: { duration: 4, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 7 } }] },
    timeline: { ...empty.timeline, duration: 4, tracks: [
      { ...flags, id: "main", name: "Main", type: "video", clips: [clip] },
      ...(linked ? [{ ...flags, id: "dialogue", name: "Dialogue", type: "audio" as const, clips: [{ ...clip, id: "audio", trackId: "dialogue", metadata: { separatedFromClipId: "video" } }] }] : []),
    ] },
  };
  useProjectStore.getState().actionHistory.clear();
  useProjectStore.setState({ project, hasOpenProject: true, clipUndoStack: [], clipRedoStack: [], templateUndoStack: [], templateRedoStack: [] });
  useTimelineStore.setState({ playheadPosition: 2, playbackState: "paused", playbackLockedReason: null });
  useUIStore.setState({ selectedItems: [], effectApplicationClipId: null, exportState: { isExporting: false, phase: "", progress: 0 } });
  useEditorWorkspaceStore.setState({ section: "media", textSource: "text", mobileCaptionsOpen: false, audioSource: "music", linkedSelection: true });
}
const selectVideo = () => useUIStore.getState().select({ type: "clip", id: "video", trackId: "main" });
beforeEach(() => seed());
afterEach(() => { cleanup(); vi.restoreAllMocks(); useUIStore.getState().clearSelection(); useInspectorNavigationStore.getState().clearRequest(); useProjectStore.getState().actionHistory.clear(); });

describe("mobile editing tools", () => {
  it("finds the preserved reset action, applies it through history and disables an unchanged reset", async () => {
    await useProjectStore.getState().updateClipTransform("video", { position: { x: 20, y: -8 }, scale: { x: 1.2, y: 1.2 } });
    useProjectStore.getState().actionHistory.clear();
    selectVideo();
    render(<MobileEditorTools onPanel={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "Back to main tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Find tool" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search tools" }), { target: { value: "reset transform" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset clip transform" }));
    await waitFor(() => expect(useProjectStore.getState().getClip("video")?.transform.position).toEqual({ x: 0, y: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "Find tool" }));
    expect(screen.getByRole("button", { name: "Reset clip transform" })).toBeDisabled();
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getClip("video")?.transform.position).toEqual({ x: 20, y: -8 });
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("splits linked video and audio with the actual edit history and undoes once", async () => {
    seed(true); selectVideo(); render(<MobileEditorTools onPanel={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks.map(t => t.clips.length)).toEqual([2, 2]));
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().project.timeline.tracks.map(t => t.clips.length)).toEqual([1, 1]);
  });

  it("blocks locked companions, exporting and split boundaries", () => {
    seed(true); selectVideo();
    const project = useProjectStore.getState().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(t => ({ ...t, locked: t.id === "dialogue" })) } } });
    render(<MobileEditorTools onPanel={vi.fn()}/>);
    expect(screen.getByRole("button", { name: "Split" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    act(() => { useEditorWorkspaceStore.getState().setLinkedSelection(false); useTimelineStore.setState({ playheadPosition: 0 }); });
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Split" })).toBeDisabled();
    act(() => useUIStore.getState().setExportState({ isExporting: true, progress: 0, phase: "encoding" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("keeps text overlays editable, deletes them through history, and restores with Undo", async () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: [...project.timeline.tracks, { id: "titles", name: "Titles", type: "text", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false }] } } });
    const title = useProjectStore.getState().createTextClip("titles", 0, "Golden Hour", 4);
    expect(title).not.toBeNull();
    useUIStore.getState().select({ type: "text-clip", id: title!.id, trackId: "titles" });
    useProjectStore.getState().actionHistory.clear();
    render(<MobileEditorTools onPanel={vi.fn()}/>);
    expect(screen.getByText("Clip 1 of 1 · Golden Hour")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Animate" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Volume" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(useProjectStore.getState().getTextClip(title!.id)).toBeUndefined());
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().getTextClip(title!.id)?.text).toBe("Golden Hour");
  });

});
