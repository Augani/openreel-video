import { useCallback, useSyncExternalStore } from "react";
import { useChatStore } from "../../../stores/chat-store";
import { useProjectStore } from "../../../stores/project-store";
import { aiUndoCheckpoint } from "../../../services/agent/undo-checkpoint";

/** A later manual edit must never leave an AI-only Undo affordance enabled. */
export function useAIUndoAvailability(): boolean {
  const committed = useChatStore(s => s.lastTurnCommitted);
  const status = useChatStore(s => s.status);
  const actionId = useChatStore(s => s.lastTurnActionId);
  const undoSize = useChatStore(s => s.lastTurnUndoSize);
  const history = useProjectStore(s => s.actionHistory);
  const subscribe = useCallback((notify: () => void) => {
    const stopProject = useProjectStore.subscribe(notify);
    const stopHistory = history.subscribe(notify);
    return () => { stopProject(); stopHistory(); };
  }, [history]);
  const snapshot = useCallback(() => {
    const checkpoint = aiUndoCheckpoint(useProjectStore.getState());
    return (actionId === null || checkpoint.actionId === actionId) &&
      (undoSize === null || checkpoint.size === undoSize);
  }, [actionId, undoSize]);
  // Some engine edits publish project data before pushing their history entry.
  // Observe both sources, while only publishing a changed availability boolean.
  const unchanged = useSyncExternalStore(subscribe, snapshot, snapshot);
  return committed && status !== "running" && status !== "awaiting_confirm" && unchanged;
}
