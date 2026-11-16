import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptionWorkspace } from "./CaptionWorkspace";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import type { Clip, MediaItem } from "@openreel/core";

let phone = true;
const resizeListeners = new Set<() => void>();
beforeEach(() => {
  phone = true; resizeListeners.clear();
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: phone, media: query, onchange: null,
    addEventListener: (_type: string, listener: unknown) => resizeListeners.add(listener as () => void),
    removeEventListener: (_type: string, listener: unknown) => resizeListeners.delete(listener as () => void),
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true }));
  useProjectStore.getState().loadProject(createEmptyProject("Caption session"));
  useProjectStore.getState().actionHistory.clear();
  useTimelineStore.setState({ playheadPosition: 2, playbackLockedReason: null });
  useUIStore.setState({ selectedItems: [], exportState: { isExporting: false, phase: "", progress: 0 } });
  useEditorWorkspaceStore.setState({ mobileCaptionsOpen: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function workspace() { return <CaptionWorkspace active language="en" onLanguageChange={vi.fn()} style="pop-words" onStyleChange={vi.fn()}/>; }
describe("caption workspace presentations", () => {
  it("opens all dialogue clips by default and keeps explicit selected-clip captioning without starting a worker", async () => {
    phone = false;
    const empty = createEmptyProject("Dialogue routing", undefined, true);
    const dialogue = empty.timeline.tracks.find(track => track.role === "dialogue")!;
    const media: MediaItem = { id: "voice", name: "Dialogue.wav", type: "audio", fileHandle: null, blob: new Blob(["audio"]),
      thumbnailUrl: null, waveformData: null, metadata: { duration: 20, width: 0, height: 0, frameRate: 0,
        codec: "wav", sampleRate: 48000, channels: 1, fileSize: 5 } };
    const clip: Clip = { id: "first", trackId: dialogue.id, mediaId: media.id, startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
      volume: 1, effects: [], audioEffects: [], keyframes: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: .5, y: .5 }, rotation: 0, opacity: 1 } };
    useProjectStore.getState().loadProject({ ...empty, mediaLibrary: { items: [media] }, timeline: { ...empty.timeline,
      tracks: empty.timeline.tracks.map(track => track.id === dialogue.id ? { ...track, clips: [clip, { ...clip, id: "second", startTime: 8 }] } : track),
    } });
    const worker = vi.fn(); vi.stubGlobal("Worker", worker);
    render(workspace());
    expect(screen.getByRole("button", { name: "Transcribe 2 Clips" })).toBeEnabled();
    act(() => useUIStore.getState().select({ type: "clip", id: "second", trackId: dialogue.id }));
    expect(screen.getByRole("button", { name: "Transcribe Selected Clip" })).toBeEnabled();
    act(() => useUIStore.getState().clearSelection());
    expect(screen.getByRole("button", { name: "Transcribe 2 Clips" })).toBeEnabled();
    expect(worker).not.toHaveBeenCalled();
  });
  it("creates editable text at the playhead with one undo and keeps manual editing available", async () => {
    render(workspace());
    await screen.findByRole("dialog", { name: "Captions" });
    fireEvent.click(screen.getByRole("radio", { name: "Manual" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Manual caption text" }), { target: { value: "Real caption" } });
    fireEvent.click(screen.getByRole("button", { name: "Add caption at playhead" }));
    await waitFor(() => expect(useProjectStore.getState().getAllTextClips()).toHaveLength(1));
    expect(useProjectStore.getState().getAllTextClips()[0]).toMatchObject({ text: "Real caption", startTime: 2, duration: 3, metadata: { captionSource: "manual" } });
    expect(useProjectStore.getState().getAllTextClips()[0].style).toMatchObject({ fontFamily: "Inter", fontSize: 96, fontWeight: 800, color: "#111111", backgroundColor: "#f5d547" });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Manual caption text" })).toHaveValue(""));
    expect(screen.getByRole("textbox", { name: "Find caption text" })).toBeInTheDocument();
    expect(useTimelineStore.getState().playbackLockedReason).toBeNull();
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(0);
  });
});
