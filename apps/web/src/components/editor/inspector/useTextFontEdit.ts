import { useCallback, useEffect, useRef } from "react";
import type { TextStyle } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";

type FontOwner = ReturnType<typeof useProjectStore.getState>["actionExecutor"];
const requests = new WeakMap<FontOwner, Map<string, object>>();

/** Reserve the font intent before any loading, including custom-file decoding. */
export function useTextFontEdit(projectId: string, clipIds: readonly string[]) {
  const owner = useProjectStore((state) => state.actionExecutor);
  const targetScope = clipIds.join("\0");
  const cancelCurrent = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelCurrent.current?.(), [projectId, owner, targetScope]);

  return useCallback(() => {
    cancelCurrent.current?.();
    const initial = useProjectStore.getState();
    const targetIds = [...new Set(targetScope.split("\0"))].filter(Boolean);
    const initialTitles = targetIds.length > 1
      ? new Map(initial.project.textClips?.map(clip => [clip.id, clip]))
      : null;
    const families = new Map(targetIds.map((id) => [
      id, (initialTitles ? initialTitles.get(id) : initial.project.textClips?.find(clip => clip.id === id))?.style.fontFamily,
    ]));
    const token = {};
    const pending = requests.get(owner) ?? new Map<string, object>();
    requests.set(owner, pending);
    for (const id of targetIds) pending.set(id, token);
    let active = initial.project.id === projectId && initial.actionExecutor === owner && targetIds.length > 0;
    const isCurrent = () => {
      const state = useProjectStore.getState();
      if (!active || state.project.id !== projectId || state.actionExecutor !== owner) return false;
      const currentTitles = targetIds.length > 1
        ? new Map(state.project.textClips?.map(clip => [clip.id, clip]))
        : null;
      return targetIds.every((id) => {
        const clip = currentTitles ? currentTitles.get(id) : state.project.textClips?.find(candidate => candidate.id === id);
        return pending.get(id) === token && clip && clip.style.fontFamily === families.get(id);
      });
    };
    const cancel = () => {
      active = false;
      for (const id of targetIds) if (pending.get(id) === token) pending.delete(id);
      if (cancelCurrent.current === cancel) cancelCurrent.current = undefined;
    };
    cancelCurrent.current = cancel;
    return {
      isCurrent,
      cancel,
      commit: (changes: Partial<TextStyle>) => {
        if (!isCurrent()) { cancel(); return false; }
        const state = useProjectStore.getState();
        const batch = targetIds.length > 1;
        if (batch) state.beginHistoryGroup("Update selected text properties");
        try {
          for (const id of targetIds) state.updateTextStyle(id, changes);
          return true;
        } finally {
          if (batch) state.endHistoryGroup();
          cancel();
        }
      },
    };
  }, [owner, projectId, targetScope]);
}
