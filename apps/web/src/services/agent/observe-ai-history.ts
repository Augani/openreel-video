import { useChatStore } from "../../stores/chat-store";
import { useProjectStore } from "../../stores/project-store";

let consumers = 0;
let dispose: (() => void) | undefined;

/** One shared observer follows ordinary Undo/Redo even while the AI panel is closed. */
export function observeAIHistory(): () => void {
  if (consumers++ === 0) {
    let revision = "";
    const sync = () => {
      const project = useProjectStore.getState();
      const current = project.actionHistory;
      const next = [project.project.id, current.getUndoStackSize(), current.peekUndo()?.action.id,
        current.getRedoStackSize(), current.peekRedo()?.action.id, project.clipUndoStack.length, project.templateUndoStack.length].join(":");
      // Preview/project publications often precede history publication. Only the
      // history change needs the bounded membership scan, not every publication.
      if (next === revision) return;
      revision = next;
      useChatStore.getState().syncHistory();
    };
    let history = useProjectStore.getState().actionHistory;
    let stopHistory = history.subscribe(sync);
    const stopProject = useProjectStore.subscribe((state, previous) => {
      if (state.actionHistory !== history) {
        stopHistory();
        history = state.actionHistory;
        stopHistory = history.subscribe(sync);
        revision = "";
      }
      if (state.project !== previous.project || state.clipUndoStack !== previous.clipUndoStack || state.templateUndoStack !== previous.templateUndoStack) sync();
    });
    dispose = () => { stopProject(); stopHistory(); };
    sync();
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (--consumers === 0) { dispose?.(); dispose = undefined; }
  };
}
