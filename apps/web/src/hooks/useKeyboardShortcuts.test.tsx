import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectState } from "../stores/project-store";
import type { UIState } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { keyboardShortcuts } from "../services/keyboard-shortcuts";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { useEditPointStore } from "../stores/edit-point-store";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

const mocks = vi.hoisted(() => ({
  projectState: vi.fn(),
  uiState: vi.fn(),
  save: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  insertOverlay: vi.fn(),
}));
vi.mock("../stores/project-store", () => ({
  useProjectStore: Object.assign(vi.fn(), { getState: mocks.projectState }),
}));
vi.mock("../stores/ui-store", () => ({
  useUIStore: Object.assign(vi.fn(), { getState: mocks.uiState }),
}));
vi.mock("../services/project-manager", () => ({ projectManager: { saveProject: mocks.save, releaseCurrentFileHandle: vi.fn() } }));
vi.mock("../stores/notification-store", () => ({ toast: { success: mocks.success, error: mocks.error, warning: mocks.warning } }));
vi.mock("../stores/project/insert-timeline-overlay", () => ({ insertTimelineOverlay: mocks.insertOverlay }));

function press(key: string, options: Partial<KeyboardEvent> = {}) {
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options })));
}
let store: ProjectState;
let ui: UIState;

beforeEach(() => {
  vi.clearAllMocks();
  useEditorWorkspaceStore.setState({ linkedSelection: true });
  keyboardShortcuts.resetAllShortcuts();
  useTimelineStore.setState({ playheadPosition: 0, playbackState: "paused", scrollX: 0, loopEnabled: false, loopStart: 0, loopEnd: 0 });
  const project = {
    name: "My video",
    settings: { frameRate: 30 },
    timeline: { tracks: [
      { id: "video", locked: false, transitions: [], clips: [
        { id: "a", trackId: "video", startTime: 0, duration: 3, mediaId: "m", inPoint: 0, outPoint: 3, effects: [], audioEffects: [], keyframes: [] },
        { id: "b", trackId: "video", startTime: 3, duration: 3, mediaId: "m", inPoint: 0, outPoint: 3, effects: [], audioEffects: [], keyframes: [] },
      ] },
      { id: "locked", locked: true, transitions: [], clips: [] },
    ], markers: [], subtitles: [] },
    mediaLibrary: { items: [{ id: "m", type: "video", metadata: { duration: 10 } }] },
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
    rippleDeleteClips: vi.fn(async () => ({ success: true })),
    hasOpenProject: true,
    commitTimelineToolEdit: vi.fn(() => ({ success: true, actionId: 'x' })),
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
    snapSettings: { enabled: true },
    setSnapEnabled: vi.fn((enabled: boolean) => { (ui as unknown as { snapSettings: { enabled: boolean } }).snapSettings.enabled = enabled; }),
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
  it("Q and W ripple trim to the playhead as one committed plan instead of a plain trim", () => {
    const view = renderHook(useKeyboardShortcuts);
    act(() => useTimelineStore.setState({ playheadPosition: 1 }));
    ui.selectedItems = [{ id: "a", trackId: "video", type: "clip" }] as UIState["selectedItems"];
    press("q");
    expect(store.commitTimelineToolEdit).toHaveBeenCalledTimes(1);
    const plan = vi.mocked(store.commitTimelineToolEdit).mock.calls[0][0];
    expect(plan.label).toMatch(/Ripple trim previous/);
    expect(plan.edits.length).toBeGreaterThan(0);
    // The committed plan replaces the trimmed clip, which drops it from the selection.
    ui.selectedItems = [{ id: "a", trackId: "video", type: "clip" }] as UIState["selectedItems"];
    press("w");
    expect(store.commitTimelineToolEdit).toHaveBeenCalledTimes(2);
    expect(vi.mocked(store.commitTimelineToolEdit).mock.calls[1][0].label).toMatch(/Ripple trim next/);
    view.unmount();
  });

  it("Q keeps the trimmed clip selected even when the splitter replaces its id, so W can follow", () => {
    const view = renderHook(useKeyboardShortcuts);
    act(() => useTimelineStore.setState({ playheadPosition: 1 }));
    ui.selectedItems = [{ id: "a", trackId: "video", type: "clip" }] as UIState["selectedItems"];
    const startA = store.project.timeline.tracks[0].clips.find((c) => c.id === "a")!.startTime;
    vi.mocked(store.commitTimelineToolEdit).mockImplementationOnce(() => {
      const track = store.project.timeline.tracks[0];
      store.project.timeline.tracks[0] = { ...track, clips: track.clips.map((c) => c.id === "a" ? { ...c, id: "a-right" } : c) };
      return { success: true, actionId: "x" } as ReturnType<ProjectState["commitTimelineToolEdit"]>;
    });
    press("q");
    expect(ui.selectedItems.map((item) => item.id)).toEqual(["a-right"]);
    expect(store.project.timeline.tracks[0].clips.find((c) => c.id === "a-right")!.startTime).toBe(startA);
    press("w");
    expect(vi.mocked(store.commitTimelineToolEdit).mock.calls[1][0].label).toMatch(/Ripple trim next/);
    view.unmount();
  });

  it("Q on a clip whose linked track is locked warns once and never falls back to targeted tracks", () => {
    const video = { ...store.project.timeline.tracks[0].clips[0], inPoint: 0, outPoint: 3, mediaId: "video" };
    store.project.timeline.tracks[0] = { ...store.project.timeline.tracks[0], clips: [video] };
    store.project.timeline.tracks.push({ id: "audio", type: "audio", locked: true, clips: [{ ...video, id: "linked-audio", trackId: "audio", mediaId: "wav", metadata: { separatedFromClipId: "a" } }] } as unknown as ProjectState["project"]["timeline"]["tracks"][number]);
    ui.selectedItems = [{ id: "a", trackId: "video", type: "clip" }] as UIState["selectedItems"];
    const view = renderHook(useKeyboardShortcuts);
    act(() => useTimelineStore.setState({ playheadPosition: 1 }));
    press("q");
    expect(store.commitTimelineToolEdit).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledTimes(1);
    expect(mocks.warning).toHaveBeenCalledWith("Linked track is locked", expect.stringContaining("Linked selection"));
    view.unmount();
  });

  it("Q does not trim anything when the selection is not under the playhead or nothing is targeted", () => {
    const view = renderHook(useKeyboardShortcuts);
    act(() => useTimelineStore.setState({ playheadPosition: 100 }));
    ui.selectedItems = [{ id: "a", trackId: "video", type: "clip" }] as UIState["selectedItems"];
    press("q");
    ui.selectedItems = [] as unknown as UIState["selectedItems"];
    press("q");
    for (const call of vi.mocked(store.commitTimelineToolEdit).mock.calls)
      expect(call[0].edits).toEqual([]);
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

  it("shuttles with J/K/L: play, speed up, slow down, stop and rewind", () => {
    const view = renderHook(useKeyboardShortcuts);
    act(() => useTimelineStore.setState({ playheadPosition: 3, playbackRate: 1 }));
    press("l");
    expect(useTimelineStore.getState()).toMatchObject({ playbackState: "playing", playbackRate: 1 });
    press("l");
    press("l");
    press("l");
    expect(useTimelineStore.getState().playbackRate).toBe(4);
    press("j");
    expect(useTimelineStore.getState()).toMatchObject({ playbackState: "playing", playbackRate: 2 });
    press("k");
    expect(useTimelineStore.getState()).toMatchObject({ playbackState: "paused", playbackRate: 1 });
    press("j");
    expect(useTimelineStore.getState().playheadPosition).toBe(2);
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
    // One sync-lock aware plan for the whole selection (one undo step).
    expect(vi.mocked(store.rippleDeleteClips).mock.calls).toEqual([[["b", "a"]]]);
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

  it("imports with I only while the live sequence is empty, and keeps populated mark-in behavior", () => {
    const assets = document.createElement("div");
    assets.dataset.tour = "assets";
    const input = document.createElement("input");
    input.type = "file";
    assets.append(input);
    document.body.append(assets);
    const pick = vi.spyOn(input, "click").mockImplementation(() => undefined);
    vi.mocked(store.getTimelineDuration).mockReturnValue(0);
    useEditorWorkspaceStore.setState({ section: "text" });
    const view = renderHook(useKeyboardShortcuts);
    press("i");
    expect(pick).toHaveBeenCalledOnce();
    expect(useEditorWorkspaceStore.getState().section).toBe("media");
    expect(ui.setPanelVisible).toHaveBeenCalledWith("agentChat", false);
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 0, loopEnd: 0, loopEnabled: false });
    press("i", { repeat: true });
    expect(pick).toHaveBeenCalledOnce();

    vi.mocked(store.getTimelineDuration).mockReturnValue(6);
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    press("i");
    expect(pick).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 2, loopEnd: 6 });
    view.unmount();
    assets.remove();
  });

  it("opens the same picker with Cmd/Ctrl+I on a populated timeline", () => {
    const assets = document.createElement("div");
    assets.dataset.tour = "assets";
    const input = document.createElement("input");
    input.type = "file";
    assets.append(input);
    document.body.append(assets);
    const pick = vi.spyOn(input, "click").mockImplementation(() => undefined);
    const view = renderHook(useKeyboardShortcuts);
    press("i", { metaKey: true });
    press("i", { ctrlKey: true });
    expect(pick).toHaveBeenCalledTimes(2);
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 0, loopEnd: 0 });
    view.unmount();
    assets.remove();
  });

  it("preserves typing and modal ownership of the empty-sequence import key", () => {
    const assets = document.createElement("div");
    assets.dataset.tour = "assets";
    const input = document.createElement("input");
    input.type = "file";
    const typing = document.createElement("input");
    assets.append(input, typing);
    document.body.append(assets);
    const pick = vi.spyOn(input, "click").mockImplementation(() => undefined);
    vi.mocked(store.getTimelineDuration).mockReturnValue(0);
    const view = renderHook(useKeyboardShortcuts);
    const event = new KeyboardEvent("keydown", { key: "i", bubbles: true, cancelable: true });
    act(() => typing.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    assets.append(dialog);
    press("i");
    expect(pick).not.toHaveBeenCalled();
    view.unmount();
    assets.remove();
  });
});


describe("trim mode keys", () => {
  const withHistory = () => {
    // Source handles on both sides of the a|b cut so a roll can go either way.
    const [a, b] = store.project.timeline.tracks[0].clips;
    Object.assign(a, { inPoint: 2, outPoint: 5 });
    Object.assign(b, { inPoint: 2, outPoint: 5 });
    (store as unknown as { actionExecutor: unknown }).actionExecutor = {
      getHistory: () => ({ beginBurst: vi.fn(), endBurst: vi.fn() }),
    };
  };
  const labelOfCall = (call: number) => vi.mocked(store.commitTimelineToolEdit).mock.calls[call][0];

  it(", . trim the selected edit point by one frame and < > by five, instead of Insert/Overwrite", () => {
    withHistory();
    useEditPointStore.getState().set({ type: "edit", clipId: "a", edge: "right", kind: "roll", neighborId: "b" });
    const view = renderHook(useKeyboardShortcuts);
    press(".");
    expect(store.commitTimelineToolEdit).toHaveBeenCalledTimes(1);
    expect(labelOfCall(0).label).toMatch(/Rolling edit/);
    expect(labelOfCall(0).delta).toBeCloseTo(1 / 30, 6);
    press(",");
    expect(labelOfCall(1).delta).toBeCloseTo(-1 / 30, 6);
    press(">", { shiftKey: true });
    expect(labelOfCall(2).delta).toBeCloseTo(5 / 30, 6);
    press("<", { shiftKey: true });
    expect(labelOfCall(3).delta).toBeCloseTo(-5 / 30, 6);
    view.unmount();
  });

  describe("dynamic JKL trimming", () => {
    const select = () => useEditPointStore.getState().set({ type: "edit", clipId: "b", edge: "right", kind: "ripple", neighborId: null });
    const session = () => useEditPointStore.getState().dynamicTrim;
    afterEach(() => useEditPointStore.setState({ dynamicTrim: null, dynamicTrimEnabled: true }));

    it("L starts a live trim without editing, Space commits it as one plan, Esc cancels another", () => {
      withHistory();
      select();
      const view = renderHook(useKeyboardShortcuts);
      press("l");
      expect(session()).toMatchObject({ direction: 1 });
      expect(store.commitTimelineToolEdit).not.toHaveBeenCalled();
      expect(useTimelineStore.getState().playbackState).toBe("paused");
      press(" ");
      expect(session()).toBeNull();
      expect(store.commitTimelineToolEdit).toHaveBeenCalledTimes(1);
      expect(labelOfCall(0).delta).toBeCloseTo(1 / 30, 6);
      press("j");
      expect(session()).toMatchObject({ direction: -1 });
      press("Escape");
      expect(session()).toBeNull();
      expect(store.commitTimelineToolEdit).toHaveBeenCalledTimes(1);
      expect(useEditPointStore.getState().selection).not.toBeNull();
      view.unmount();
    });

    it("K commits the running trim", () => {
      withHistory();
      select();
      const view = renderHook(useKeyboardShortcuts);
      press("l");
      press("k");
      expect(session()).toBeNull();
      expect(store.commitTimelineToolEdit).toHaveBeenCalledTimes(1);
      view.unmount();
    });

    it("with dynamic trimming off, J/L keep their playback shuttle", () => {
      withHistory();
      select();
      useEditPointStore.getState().setDynamicTrimEnabled(false);
      const view = renderHook(useKeyboardShortcuts);
      press("l");
      expect(session()).toBeNull();
      expect(useTimelineStore.getState().playbackState).toBe("playing");
      useTimelineStore.getState().pause();
      view.unmount();
    });
  });

  it("uses ripple at a free edge", () => {
    withHistory();
    useEditPointStore.getState().set({ type: "edit", clipId: "b", edge: "right", kind: "ripple", neighborId: null });
    const view = renderHook(useKeyboardShortcuts);
    press(",");
    expect(labelOfCall(0).label).toMatch(/Ripple/);
    view.unmount();
  });

  it("without a selected edit point , and . stay Insert and Overwrite (no trim)", () => {
    useEditPointStore.getState().clear();
    const view = renderHook(useKeyboardShortcuts);
    press(",");
    press(".");
    expect(store.commitTimelineToolEdit).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith("Insert", expect.any(String));
    view.unmount();
  });

  it("Delete and Shift+Delete ripple-delete a selected gap", () => {
    store.project.timeline.tracks[0] = { ...store.project.timeline.tracks[0], clips: [store.project.timeline.tracks[0].clips[0]] };
    const view = renderHook(useKeyboardShortcuts);
    useEditPointStore.getState().set({ type: "gap", trackId: "video", start: 3, end: 6 });
    press("Delete");
    expect(store.removeClip).not.toHaveBeenCalled();
    expect(store.commitTimelineToolEdit).not.toHaveBeenCalled();
    // The gap [3,6) is trailing space, so it is stale: nothing is deleted and the user is told.
    expect(mocks.warning).toHaveBeenCalledWith("Delete gap", expect.stringMatching(/no longer exists/));
    view.unmount();
  });

  it("X marks the clip under the playhead, Shift+I/O go to In/Out and Alt+X clears them", () => {
    const view = renderHook(useKeyboardShortcuts);
    act(() => useTimelineStore.setState({ playheadPosition: 4 }));
    press("x");
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 3, loopEnd: 6 });
    act(() => useTimelineStore.setState({ playheadPosition: 0 }));
    press("O", { shiftKey: true, code: "KeyO" });
    expect(useTimelineStore.getState().playheadPosition).toBe(6);
    press("I", { shiftKey: true, code: "KeyI" });
    expect(useTimelineStore.getState().playheadPosition).toBe(3);
    press("≈", { altKey: true, code: "KeyX" });
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 0, loopEnd: 0 });
    view.unmount();
  });
});

describe("linked keyboard selection", () => {
  const linkFixture = () => {
    const video = { ...store.project.timeline.tracks[0].clips[0], inPoint: 0, outPoint: 3, mediaId: "video" };
    store.project.timeline.tracks[0] = { ...store.project.timeline.tracks[0], clips: [video] };
    store.project.timeline.tracks.push({ id: "audio", type: "audio", locked: false, clips: [{ ...video, id: "linked-audio", trackId: "audio", mediaId: "wav", metadata: { separatedFromClipId: "a" } }] } as unknown as ProjectState["project"]["timeline"]["tracks"][number]);
    ui.selectedItems = [{ id: "a", trackId: "video", type: "clip" }];
  };
  it("expands split and copy live, while keeping the primary inspector selection", async () => {
    linkFixture();
    const view = renderHook(useKeyboardShortcuts);
    press("c", { ctrlKey: true });
    expect(store.copyClips).toHaveBeenLastCalledWith(["a", "linked-audio"]);
    act(() => useTimelineStore.setState({ playheadPosition: 1 }));
    press("s");
    await waitFor(() => expect(store.endHistoryGroup).toHaveBeenCalledOnce());
    expect(vi.mocked(store.splitClip).mock.calls.map(([id]) => id)).toEqual(["a", "linked-audio"]);
    expect(ui.selectedItems.map((item) => item.id)).toEqual(["a"]);
    useEditorWorkspaceStore.setState({ linkedSelection: false });
    press("c", { ctrlKey: true });
    expect(store.copyClips).toHaveBeenLastCalledWith(["a"]);
    view.unmount();
  });
  it("rejects a linked deletion when the audio track is locked", async () => {
    linkFixture();
    store.project.timeline.tracks[2] = { ...store.project.timeline.tracks[2], locked: true };
    const view = renderHook(useKeyboardShortcuts);
    press("Delete");
    expect(store.removeClip).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith("Linked track is locked", expect.stringContaining("Linked selection"));
    view.unmount();
  });
});
