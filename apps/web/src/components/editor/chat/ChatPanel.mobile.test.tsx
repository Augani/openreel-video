import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useChatStore } from "../../../stores/chat-store";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import "../mobile/MobileAISheet";

let phone = true;
const listeners = new Set<() => void>();
function resize(next: boolean) { act(() => { phone = next; for (const listener of listeners) listener(); }); }
beforeEach(async () => {
  phone = true; listeners.clear();
  vi.spyOn(window,"matchMedia").mockImplementation(query => ({ matches: phone, media: query, onchange: null,
    addEventListener: (_type: string, listener: unknown) => listeners.add(listener as () => void),
    removeEventListener: (_type: string, listener: unknown) => listeners.delete(listener as () => void),
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true }));
  useChatStore.getState().reset();
  useProjectStore.getState().loadProject(createEmptyProject("AI sheet QA"));
  await useProjectStore.getState().addTrack("video");
  useProjectStore.getState().actionHistory.clear();
  useUIStore.setState({ exportState: { isExporting: false, progress: 0, phase: "" } });
  useUIStore.getState().setPanelVisible("agentChat",true);
  useTimelineStore.setState({ playbackLockedReason: null });
  useAIConnectionStore.getState().configure({ provider: "compatible", model: "Fixture model", baseUrl: "http://localhost:9911/v1", apiKey: "" });
});
afterEach(() => { cleanup(); useChatStore.getState().reset(); useEditorWorkspaceStore.getState().setAIConnectionOpen(false); vi.restoreAllMocks(); });
function mount() { return render(<ChatPanel onClose={() => useUIStore.getState().setPanelVisible("agentChat",false)}/>); }
async function seedAppliedTurn() {
  const store = useProjectStore.getState();
  let created!: NonNullable<ReturnType<typeof store.createTextClip>>;
  act(() => { created = store.createTextClip(store.project.timeline.tracks[0].id,0,"Actual title",3)!; });
  const history = useProjectStore.getState().actionExecutor.getHistory();
  act(() => useChatStore.setState({ status: "idle", lastTurnCommitted: true, lastTurnUndoSize: history.getUndoStackSize(), lastTurnActionId: history.peekUndo()!.action.id,
    messages: [{ id: "user", role: "user", text: "Add a title", toolCalls: [] }, { id: "result", role: "assistant", text: "Your title is editable.", editSummary: { beforeDuration: 0, afterDuration: 3,
      checkpoint: { projectId: store.project.id, actionId: history.peekUndo()!.action.id, undoSize: history.getUndoStackSize() } },
      toolCalls: [{ id: "write", name: "create_text_clip", args: { time: 0 }, status: "done", result: { ok: true, summary: "Added Actual title", data: { id: created.id } } },
        { id: "read", name: "list_text_clips", args: {}, status: "done", result: { ok: true, summary: "Read text clips" } }] }] }));
  return created;
}
describe("mobile AI sheet", () => {
  it("renders actual completed edits, retains details and undoes the real title in one step", async () => {
    mount(); await screen.findByRole("dialog",{name:"AI assist"});
    const title = await seedAppliedTurn();
    expect(screen.getByRole("button",{name:"View assistant response and edit details"})).toHaveTextContent("Done · 0:00 → 0:03");
    expect(screen.queryByRole("button",{name:"Read text clips"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Added Actual title"}));
    expect(useUIStore.getState().selectedItems[0]?.id).toBe(title.id);
    fireEvent.click(screen.getByRole("button",{name:"View assistant response and edit details"}));
    expect(screen.getByText("Your title is editable.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Undo all edits in the last AI turn"}));
    await waitFor(() => expect(useProjectStore.getState().getAllTextClips()).toHaveLength(0));
    expect(screen.getByRole("button",{name:"View assistant response and edit details"})).toHaveTextContent("Undone");
    resize(false);
    expect(screen.getByRole("button",{name:"Added Actual title Undone"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Read text clips Done"})).toBeInTheDocument();
  });
  it("protects a later manual edit from the turn Undo control", async () => {
    mount(); await screen.findByRole("dialog",{name:"AI assist"}); await seedAppliedTurn();
    act(() => {
      const store = useProjectStore.getState();
      store.createTextClip(store.project.timeline.tracks[0].id,4,"Manual addition",2);
    });
    expect(screen.getByRole("button",{name:"Undo all edits in the last AI turn"})).toBeDisabled();
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(2);
  });
});
