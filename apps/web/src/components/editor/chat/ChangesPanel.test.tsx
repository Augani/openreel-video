import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleEngine } from "@openreel/core";
import { ChangesPanel } from "./ChangesPanel";
import { useChatStore } from "../../../stores/chat-store";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";

beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine() });
  useProjectStore.getState().createNewProject("Change navigation QA");
  useChatStore.getState().reset();
  useUIStore.setState({ selectedItems: [], exportState: { isExporting: false, progress: 0, phase: "" } });
  useTimelineStore.setState({ playheadPosition: 0, playbackLockedReason: null });
});
afterEach(() => { cleanup(); useChatStore.getState().reset(); vi.useRealTimers(); });

function appliedTitle(recorded = false) {
  const store = useProjectStore.getState();
  const track = store.project.timeline.tracks.find(track => track.type === "text") ?? store.project.timeline.tracks[0];
  const title = store.createTextClip(track.id, 4, "Actual title", 3)!;
  const history = store.actionExecutor.getHistory();
  useChatStore.setState({ status: "idle", lastTurnCommitted: true,
    lastTurnUndoSize: history.getUndoStackSize(), lastTurnActionId: history.peekUndo()?.action.id ?? null,
    messages: [{ id: `user-${title.id}`, role: "user", text: "Add a title", toolCalls: [] },
      { id: `assistant-${title.id}`, role: "assistant", text: "Done", editSummary: { beforeDuration: 0, afterDuration: 7,
        checkpoint: { projectId: store.project.id, actionId: history.peekUndo()!.action.id, undoSize: history.getUndoStackSize() } }, toolCalls: [{
        id: "write", name: "create_text_clip", args: {}, status: "done",
        result: { ok: true, summary: "Added Actual title", ...(recorded ? {} : { data: { id: title.id } }) },
        ...(recorded ? { timelineTarget: { projectId: store.project.id, id: title.id, trackId: track.id, kind: "text" as const, startTime: 4, duration: 3 } } : {}),
      }] }] });
  return title;
}

describe("AI change navigation and history affordances", () => {
  it("disables footer actions and uses icons, not typed glyphs, before the first AI turn", () => {
    const { container } = render(<ChangesPanel />);
    expect(screen.getByRole("button", { name: "Undo all edits in the last AI turn" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep all" })).toBeDisabled();
    const footer = container.querySelector("footer")!;
    expect(footer.textContent).not.toMatch(/[✓?]/);
    expect(footer.querySelectorAll("p > svg").length).toBe(3);
  });
  it("disables turn Undo after a later manual edit", () => {
    appliedTitle(); render(<ChangesPanel />);
    act(() => { const store = useProjectStore.getState(); store.createTextClip(store.project.timeline.tracks[0].id, 8, "Manual title", 2); });
    expect(screen.getByRole("button", { name: /^Undo (?:turn|all edits in the last AI turn)$/ })).toBeDisabled();
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(2);
  });
  it("does not navigate while export owns the playhead", () => {
    appliedTitle(); useUIStore.setState({ exportState: { isExporting: true, progress: 0, phase: "" } });
    render(<ChangesPanel />);
    const jump = screen.getByRole("button", { name: /Added Actual title/ });
    fireEvent.click(jump);
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
    expect(useUIStore.getState().selectedItems).toEqual([]);
  });
  it("tracks ordinary project Undo and Redo in the visible change rows", async () => {
    appliedTitle(true); render(<ChangesPanel />);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(0);
    expect(screen.getByText(/00:00:04:00.*Undone/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Added Actual title/ })).toBeDisabled();
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(1);
    expect(screen.queryByText(/Undone/)).toBeNull();
    expect(screen.getByRole("button", { name: "Undo all edits in the last AI turn" })).toBeEnabled();
  });
  it("restores AI Undo after an AI-panel Undo is redone from project history", async () => {
    appliedTitle(true); render(<ChangesPanel />);
    await act(async () => { await useChatStore.getState().undoLastTurn(); });
    expect(screen.getByText(/00:00:04:00.*Undone/)).toBeInTheDocument();
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Added Actual title/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo all edits in the last AI turn" })).toBeEnabled();
  });
  it("follows more than one AI turn through ordinary Undo and Redo", async () => {
    appliedTitle(true);
    const older = useChatStore.getState().messages;
    appliedTitle(true);
    useChatStore.setState(state => ({ messages: [...older, ...state.messages] }));
    render(<ChangesPanel />);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(screen.getAllByText(/00:00:04:00.*Undone/)).toHaveLength(1);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(screen.getAllByText(/00:00:04:00.*Undone/)).toHaveLength(2);
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(screen.getAllByText(/00:00:04:00.*Undone/)).toHaveLength(1);
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(screen.queryByText(/Undone/)).toBeNull();
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(2);
  });
});
