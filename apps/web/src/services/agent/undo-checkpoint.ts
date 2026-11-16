import type { ProjectState } from "../../stores/project-store";

export function aiUndoCheckpoint(state: Pick<ProjectState, "actionExecutor" | "clipUndoStack" | "templateUndoStack">) {
  const history = state.actionExecutor.getHistory();
  return {
    size: history.getUndoStackSize() + (state.clipUndoStack?.length ?? 0) + (state.templateUndoStack?.length ?? 0),
    actionId: history.peekUndo?.()?.action.id ?? null,
  };
}
