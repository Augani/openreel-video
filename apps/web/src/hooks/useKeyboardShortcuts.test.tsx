import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectState } from "../stores/project-store";
import type { UIState } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { keyboardShortcuts } from "../services/keyboard-shortcuts";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

const mocks = vi.hoisted(() => ({
  projectState: vi.fn(),
  uiState: vi.fn(),
  save: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  insertOverlay: vi.fn(),
}));
vi.mock("../stores/project-store", () => ({
  useProjectStore: Object.assign(vi.fn(), { getState: mocks.projectState }),
}));
vi.mock("../stores/ui-store", () => ({
  useUIStore: Object.assign(vi.fn(), { getState: mocks.uiState }),
}));
vi.mock("../services/project-manager", () => ({ projectManager: { saveProject: mocks.save } }));
vi.mock("../stores/notification-store", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("../stores/project/insert-timeline-overlay", () => ({ insertTimelineOverlay: mocks.insertOverlay }));

function press(key: string, options: Partial<KeyboardEvent> = {}) {
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options })));
}
let store: ProjectState;
let ui: UIState;

beforeEach(() => {
  vi.clearAllMocks();
  keyboardShortcuts.resetAllShortcuts();
  useTimelineStore.setState({ playheadPosition: 0, playbackState: "paused", scrollX: 0, loopEnabled: false, loopStart: 0, loopEnd: 0 });
  const project = {
    name: "My video",
    settings: { frameRate: 30 },
    timeline: { tracks: [
      { id: "video", locked: false, clips: [
        { id: "a", trackId: "video", startTime: 0, duration: 3 },
        { id: "b", trackId: "video", startTime: 3, duration: 3 },
      ] },
      { id: "locked", locked: true, clips: [] },
    ], markers: [] },
    textClips: [{ id: "locked-caption", trackId: "locked", startTime: 0, duration: 6 }],
  } as unknown as ProjectState["project"];
  store = {
    project,
    getTimelineDuration: vi.fn(() => 6),
    beginHistoryGroup: vi.fn(),
    endHistoryGroup: vi.fn(),
    getClip: vi.fn((id) => project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id)),
    getTextClip: vi.fn((id) => project.textClips?.find((clip) => clip.id === id)),
    getShapeClip: vi.fn(), getSVGClip: vi.fn(), getStickerClip: vi.fn(),
    deleteTextClip: vi.fn(() => true),
    removeClip: vi.fn(async () => ({ success: true })),
    removeClipTransition: vi.fn(async () => true),
    splitClip: vi.fn(async () => ({ success: true })),
    rippleDeleteClip: vi.fn(async () => ({ success: true })),
    getFullProject: vi.fn(() => project),
    createTextClip: vi.fn((trackId, startTime) => ({ id: "title", trackId, startTime })),
    copyClips: vi.fn(),
    pasteClips: vi.fn(async () => []),
    lastPastedClipIds: [],
  } as unknown as ProjectState;
  ui = {
    selectedItems: [
      { id: "a", trackId: "video", type: "clip" },
      { id: "b", trackId: "video", type: "clip" },
      { id: "locked-caption", trackId: "locked", type: "text-clip" },
    ],
    getSelectedClipIds: vi.fn(() => ui.selectedItems.filter((item) => item.type !== "transition").map((item) => item.id)),
    selectMultiple: vi.fn((items) => { ui.selectedItems = items; }),
    select: vi.fn(),
    setPanelVisible: vi.fn(),
    openModal: vi.fn(),
  } as unknown as UIState;
  mocks.projectState.mockImplementation(() => store);
  mocks.uiState.mockImplementation(() => ui);
  mocks.save.mockResolvedValue(true);
  mocks.insertOverlay.mockImplementation(async (_time, _duration, create) => create("new-track"));
});
afterEach(() => {
  keyboardShortcuts.stopListening();
  vi.restoreAllMocks();
});

describe("keyboard editing commands", () => {
  it("reads current playback state without rerendering or reinstalling handlers each frame", () => {
    let renders = 0;
    const register = vi.spyOn(keyboardShortcuts, "registerHandler");
    const view = renderHook(() => { renders += 1; return useKeyboardShortcuts(); });
    const registrations = register.mock.calls.length;
    act(() => useTimelineStore.setState({ playheadPosition: 1.01, playbackState: "playing" }));
    press("ArrowRight");
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(31 / 30, 10);
    expect(useTimelineStore.getState().playbackState).toBe("paused");
    expect(renders).toBe(1);
    expect(register).toHaveBeenCalledTimes(registrations);
    view.unmount();
  });

  it("clamps frame navigation to the actual project end", () => {
    const view = renderHook(useKeyboardShortcuts);
    act(() => useTimelineStore.setState({ playheadPosition: 5.999 }));
    press("ArrowRight");
    expect(useTimelineStore.getState().playheadPosition).toBe(6);
    press("ArrowRight");
    expect(useTimelineStore.getState().playheadPosition).toBe(6);
    view.unmount();
  });

  it("deletes a selection sequentially in one undo group while preserving locked captions", async () => {
    let release!: (value: { success: boolean }) => void;
    vi.mocked(store.removeClip).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const view = renderHook(useKeyboardShortcuts);
    press("Backspace");
    expect(store.removeClip).toHaveBeenCalledTimes(1);
    expect(store.endHistoryGroup).not.toHaveBeenCalled();
    // A second edit must wait until the current transaction is finished.
    press("s");
    expect(store.splitClip).not.toHaveBeenCalled();
    await act(async () => release({ success: true }));
    await waitFor(() => expect(store.endHistoryGroup).toHaveBeenCalledOnce());
    expect(vi.mocked(store.removeClip).mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
    expect(store.deleteTextClip).not.toHaveBeenCalled();
    expect(store.beginHistoryGroup).toHaveBeenCalledWith("Delete selection");
    expect(ui.selectedItems.map((item) => item.id)).toEqual(["locked-caption"]);
    view.unmount();
  });

  it("always closes a failed edit transaction and reports the error", async () => {
    vi.mocked(store.removeClip).mockRejectedValueOnce(new Error("Decode failed"));
    const view = renderHook(useKeyboardShortcuts);
    press("Delete");
    await waitFor(() => expect(store.endHistoryGroup).toHaveBeenCalledOnce());
    expect(mocks.error).toHaveBeenCalledWith("Delete selection failed", "Decode failed");
    expect(ui.selectedItems).toHaveLength(3);
    view.unmount();
  });

  it("ripple deletes rightmost clips first and preserves locked selections", async () => {
    const view = renderHook(useKeyboardShortcuts);
    press("Delete", { shiftKey: true });
    await waitFor(() => expect(store.endHistoryGroup).toHaveBeenCalledOnce());
    expect(vi.mocked(store.rippleDeleteClip).mock.calls.map(([id]) => id)).toEqual(["b", "a"]);
    expect(ui.selectedItems.map((item) => item.id)).toEqual(["locked-caption"]);
    view.unmount();
  });

  it("pastes onto the selected unlocked track", async () => {
    store.project.timeline.tracks.unshift({ id: "first", locked: false, clips: [] } as unknown as ProjectState["project"]["timeline"]["tracks"][number]);
    const view = renderHook(useKeyboardShortcuts);
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    press("v", { ctrlKey: true });
    await waitFor(() => expect(store.pasteClips).toHaveBeenCalledWith("video", 2));
    view.unmount();
  });

  it("creates and selects a title at the current playhead with the text shortcut", async () => {
    const view = renderHook(useKeyboardShortcuts);
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    press("t");
    await waitFor(() => expect(ui.select).toHaveBeenCalledWith({ id: "title", trackId: "new-track", type: "text-clip" }));
    expect(store.createTextClip).toHaveBeenCalledWith("new-track", 2, "New Title", 5, expect.objectContaining({ fontSize: 96 }));
    expect(ui.setPanelVisible).toHaveBeenCalledWith("inspector", true);
    view.unmount();
  });

  it("saves a portable full project and opens the export modal", async () => {
    const view = renderHook(useKeyboardShortcuts);
    press("s", { metaKey: true });
    expect(mocks.save).toHaveBeenCalledWith(store.project);
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Project saved", "My video"));
    press("e", { ctrlKey: true });
    expect(ui.openModal).toHaveBeenCalledWith("export");
    view.unmount();
  });

  it("does not claim a save succeeded when the picker is cancelled", async () => {
    mocks.save.mockResolvedValue(false);
    const view = renderHook(useKeyboardShortcuts);
    await act(async () => press("s", { ctrlKey: true }));
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    view.unmount();
  });

  it("reports failed saves and allows the user to try again", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Disk full"));
    const view = renderHook(useKeyboardShortcuts);
    await act(async () => press("s", { ctrlKey: true }));
    expect(mocks.error).toHaveBeenCalledWith("Could not save project", "Disk full");
    expect(mocks.success).not.toHaveBeenCalled();
    await act(async () => press("s", { ctrlKey: true }));
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.success).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("marks and toggles a preview range with I, O and Shift+L", () => {
    const view = renderHook(useKeyboardShortcuts);
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    press("i");
    act(() => useTimelineStore.setState({ playheadPosition: 4 }));
    press("o");
    press("L", { shiftKey: true });
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 2, loopEnd: 4, loopEnabled: true });
    press("L", { shiftKey: true });
    expect(useTimelineStore.getState().loopEnabled).toBe(false);
    view.unmount();
  });
});
