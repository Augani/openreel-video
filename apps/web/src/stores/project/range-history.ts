import { useTimelineStore } from "../timeline-store";

/**
 * The timeline In/Out range lives in the timeline store, not in the project.
 * Commands that change the range as part of an edit (Extract clears it) store
 * the before/after range INSIDE the edit's action payload (`params.loopRange`).
 * The range then lives exactly as long as the history entry does, so undo and
 * redo of that entry restore it no matter how many operations came after.
 */
export interface LoopRangeState {
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
}

export interface LoopRangeChange {
  before: LoopRangeState;
  after: LoopRangeState;
}

export const CLEARED_LOOP_RANGE: LoopRangeState = { loopStart: 0, loopEnd: 0, loopEnabled: false };

export function readLoopRange(): LoopRangeState {
  const { loopStart, loopEnd, loopEnabled } = useTimelineStore.getState();
  return { loopStart, loopEnd, loopEnabled };
}

const isRange = (value: unknown): value is LoopRangeState =>
  !!value && typeof value === "object"
  && typeof (value as LoopRangeState).loopStart === "number"
  && typeof (value as LoopRangeState).loopEnd === "number"
  && typeof (value as LoopRangeState).loopEnabled === "boolean";

/** Restore the range stored in an action that was just undone/redone. */
export function restoreRangeForAction(
  action: { params?: Record<string, unknown> } | undefined,
  direction: "undo" | "redo",
): void {
  const change = action?.params?.loopRange as Partial<LoopRangeChange> | undefined;
  const range = direction === "undo" ? change?.before : change?.after;
  if (!isRange(range)) return;
  const { loopStart, loopEnd, loopEnabled } = range;
  useTimelineStore.setState({ loopStart, loopEnd, loopEnabled });
}
