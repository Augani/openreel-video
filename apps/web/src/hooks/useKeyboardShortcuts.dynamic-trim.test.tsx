import { act, renderHook } from "@testing-library/react";
import { ActionExecutor, type Clip } from "@openreel/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditPointStore } from "../stores/edit-point-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { keyboardShortcuts } from "../services/keyboard-shortcuts";
import { endNudgeBurst } from "../services/timeline-tool-nudge";
import { selectEditPoint } from "../services/edit-point-commands";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

const makeClip = (id: string, startTime: number, inPoint: number, duration: number): Clip => ({
  id, trackId: "main", mediaId: "source", startTime, duration, inPoint, outPoint: inPoint + duration,
  speed: 1, volume: 1, effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
});
const press = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const release = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true })); });
const geometry = () => useProjectStore.getState().project.timeline.tracks[0].clips.map((c) => [c.id, +c.startTime.toFixed(4), +(c.startTime + c.duration).toFixed(4)]);
const ORIGINAL = [["a", 0, 4], ["b", 4, 8], ["c", 10, 14]];

beforeEach(() => {
  vi.useFakeTimers();
  keyboardShortcuts.resetAllShortcuts();
  const project = createEmptyProject("Hook trim");
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project: {
      ...project,
      settings: { ...project.settings, frameRate: 30 },
      mediaLibrary: { items: [{ id: "source", name: "S", type: "video" as const, fileHandle: null, blob: null, thumbnailUrl: null, waveformData: new Float32Array(10),
        metadata: { duration: 60, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 } }] },
      timeline: { ...project.timeline, duration: 14, tracks: [{ id: "main", name: "main", type: "video" as const, locked: false, hidden: false, solo: false, muted: false, transitions: [],
        clips: [makeClip("a", 0, 10, 4), makeClip("b", 4, 20, 4), makeClip("c", 10, 30, 4)] }] },
    },
    hasOpenProject: true, actionExecutor: executor, actionHistory: executor.getHistory(),
    clipUndoStack: [], clipRedoStack: [], templateUndoStack: [], templateRedoStack: [], redoJournal: [],
  });
  useEditorWorkspaceStore.setState({ timelineTool: "select", linkedSelection: false, targetedTrackIds: [] });
  useUIStore.setState({ selectedItems: [] });
  useTimelineStore.setState({ playheadPosition: 0, playbackState: "paused" });
  useEditPointStore.setState({ selection: null, dynamicTrim: null, dynamicTrimEnabled: true });
});
afterEach(() => {
  endNudgeBurst();
  keyboardShortcuts.stopListening();
  vi.useRealTimers();
});

describe("dynamic JKL trimming through the keyboard hook", () => {
  it("J then K commits one undo step that fully restores the project", async () => {
    selectEditPoint("b", "right");
    const view = renderHook(useKeyboardShortcuts);
    press("j");
    act(() => { vi.advanceTimersByTime(400); });
    const frames = useEditPointStore.getState().dynamicTrim!.appliedFrames;
    expect(frames).toBeLessThan(-5);
    press("k");
    expect(useEditPointStore.getState().dynamicTrim).toBeNull();
    expect(geometry()[1][2]).toBeCloseTo(8 + frames / 30, 3);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(geometry()).toEqual(ORIGINAL);
    view.unmount();
  });

  it("Esc cancels and leaves nothing to undo", () => {
    selectEditPoint("b", "right");
    const view = renderHook(useKeyboardShortcuts);
    press("l");
    act(() => { vi.advanceTimersByTime(300); });
    press("Escape");
    expect(useEditPointStore.getState().dynamicTrim).toBeNull();
    expect(geometry()).toEqual(ORIGINAL);
    view.unmount();
  });

  it("K held then J steps one frame; releasing K (or a blur) returns J to shuttling", () => {
    selectEditPoint("b", "right");
    const view = renderHook(useKeyboardShortcuts);
    press("k");
    press("l");
    expect(useEditPointStore.getState().dynamicTrim).toBeNull();
    expect(geometry()[1][2]).toBeCloseTo(8 + 1 / 30, 3);
    release("k");
    press("j");
    expect(useEditPointStore.getState().dynamicTrim).toMatchObject({ direction: -1 });
    press("k");
    act(() => { window.dispatchEvent(new Event("blur")); });
    press("l");
    expect(useEditPointStore.getState().dynamicTrim).toMatchObject({ direction: 1 });
    view.unmount();
  });
});
