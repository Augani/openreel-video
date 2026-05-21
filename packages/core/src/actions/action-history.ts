import type { Action } from "../types/actions";

export interface HistoryEntry {
  readonly action: Action;
  readonly inverseAction: Action | null;
  readonly timestamp: number;
  readonly description: string;
  readonly groupId?: string;
}

export interface ActionGroup {
  id: string;
  description: string;
  actions: HistoryEntry[];
  timestamp: number;
}

export interface HistorySnapshot {
  id: string;
  name: string;
  timestamp: number;
  stackIndex: number;
}

const ACTION_DESCRIPTIONS: Record<
  string,
  (params: Record<string, unknown>) => string
> = {
  "clip/add": () => "Add clip",
  "clip/remove": () => "Delete clip",
  "clip/move": () => "Move clip",
  "clip/trim": () => "Trim clip",
  "clip/split": () => "Split clip",
  "clip/rippleDelete": () => "Ripple delete",
  "clip/duplicate": () => "Duplicate clip",
  "track/add": (params) => `Add ${params.trackType} track`,
  "track/remove": () => "Remove track",
  "effect/add": (params) => `Add ${params.effectType} effect`,
  "effect/remove": () => "Remove effect",
  "effect/update": () => "Update effect",
  "transform/update": () => "Transform clip",
  "keyframe/add": (params) => `Add ${params.property} keyframe`,
  "keyframe/remove": () => "Remove keyframe",
  "transition/add": (params) => `Add ${params.transitionType} transition`,
  "transition/remove": () => "Remove transition",
  "audio/setVolume": () => "Adjust volume",
  "audio/setFade": () => "Adjust fade",
  "subtitle/add": () => "Add subtitle",
  "subtitle/remove": () => "Remove subtitle",
  "project/rename": () => "Rename project",
  "project/updateSettings": () => "Update settings",
  "media/import": () => "Import media",
  "media/delete": () => "Delete media",
  "clip/closeGapBefore": () => "Close gap",
  "track/consolidate": () => "Remove gaps",
  "track/restorePositions": () => "Restore positions",
};

function getActionDescription(action: Action): string {
  const descFn = ACTION_DESCRIPTIONS[action.type];
  if (descFn) {
    return descFn(action.params as Record<string, unknown>);
  }
  const parts = action.type.split("/");
  return `${parts[0]}: ${parts[1] || "action"}`;
}

// Action types whose rapid repetition (slider drags, etc.) should be
// coalesced into a single undo step. Anything not in this set — clip/add,
// clip/remove, track/add, etc. — is always treated as a discrete user
// action even when fired in quick succession.
const AUTO_GROUPABLE_TYPES = new Set<string>([
  "transform/update",
  "effect/update",
  "audio/setVolume",
  "audio/setFade",
  "clip/move",
  "clip/trim",
  "clip/slip",
  "clip/slide",
  "clip/roll",
  "keyframe/move",
  "keyframe/update",
  "project/updateSettings",
]);

// Param keys that identify the target entity. Two actions of the same
// type are only grouped if they refer to the same target.
const TARGET_PARAM_KEYS = [
  "clipId",
  "effectId",
  "trackId",
  "keyframeId",
  "transitionId",
  "subtitleId",
];

function getActionTargetId(action: Action): string | null {
  const params = action.params as Record<string, unknown>;
  for (const key of TARGET_PARAM_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

export class ActionHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistorySize: number;
  private currentGroupId: string | null = null;
  private snapshots: HistorySnapshot[] = [];
  private listeners: Set<() => void> = new Set();
  private lastActionTime: number = 0;
  private autoGroupWindow: number = 100;

  constructor(maxHistorySize: number = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  push(action: Action, inverseAction: Action | null = null): void {
    const now = Date.now();
    const timeSinceLastAction = now - this.lastActionTime;
    this.lastActionTime = now;

    const lastEntry =
      this.undoStack.length > 0
        ? this.undoStack[this.undoStack.length - 1]
        : null;

    // Only auto-group when:
    // - The action type is one of the "rapid update" types (slider drag,
    //   trim handle, etc.) — not creation/deletion actions.
    // - The previous entry has the same type AND targets the same entity
    //   (same clipId, effectId, etc.), so two distinct operations don't
    //   collapse just because they happened back-to-back.
    let groupId = this.currentGroupId;
    if (
      !groupId &&
      lastEntry &&
      timeSinceLastAction < this.autoGroupWindow &&
      lastEntry.action.type === action.type &&
      AUTO_GROUPABLE_TYPES.has(action.type)
    ) {
      const lastTarget = getActionTargetId(lastEntry.action);
      const currentTarget = getActionTargetId(action);
      if (lastTarget !== null && lastTarget === currentTarget) {
        groupId = lastEntry.groupId ?? `auto-${now}`;
        if (!lastEntry.groupId) {
          this.undoStack[this.undoStack.length - 1] = { ...lastEntry, groupId };
        }
      }
    }

    const entry: HistoryEntry = {
      action,
      inverseAction,
      timestamp: now,
      description: getActionDescription(action),
      groupId: groupId || undefined,
    };

    this.undoStack.push(entry);
    this.redoStack = [];

    this.snapshots = this.snapshots.filter(
      (s) => s.stackIndex <= this.undoStack.length,
    );

    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
      this.snapshots = this.snapshots
        .map((s) => ({ ...s, stackIndex: s.stackIndex - 1 }))
        .filter((s) => s.stackIndex >= 0);
    }

    this.notify();
  }

  beginGroup(_description?: string): string {
    this.currentGroupId = `group-${Date.now()}`;
    return this.currentGroupId;
  }

  endGroup(): void {
    this.currentGroupId = null;
    this.notify();
  }

  setAutoGroupWindow(ms: number): void {
    this.autoGroupWindow = ms;
  }

  undo(): Action | null {
    const entry = this.undoStack.pop();
    if (entry) {
      this.redoStack.push(entry);
      this.notify();
      return entry.inverseAction;
    }
    return null;
  }

  undoGroup(): Action[] {
    if (this.undoStack.length === 0) return [];

    const lastEntry = this.undoStack[this.undoStack.length - 1];
    const groupId = lastEntry.groupId;

    if (!groupId) {
      const action = this.undo();
      return action ? [action] : [];
    }

    const inverseActions: Action[] = [];
    while (
      this.undoStack.length > 0 &&
      this.undoStack[this.undoStack.length - 1].groupId === groupId
    ) {
      const action = this.undo();
      if (action) inverseActions.push(action);
    }
    return inverseActions;
  }

  redo(): Action | null {
    const entry = this.redoStack.pop();
    if (entry) {
      this.undoStack.push(entry);
      this.notify();
      return entry.action;
    }
    return null;
  }

  redoGroup(): Action[] {
    if (this.redoStack.length === 0) return [];

    const nextEntry = this.redoStack[this.redoStack.length - 1];
    const groupId = nextEntry.groupId;

    if (!groupId) {
      const action = this.redo();
      return action ? [action] : [];
    }

    const actions: Action[] = [];
    while (
      this.redoStack.length > 0 &&
      this.redoStack[this.redoStack.length - 1].groupId === groupId
    ) {
      const action = this.redo();
      if (action) actions.push(action);
    }
    return actions;
  }

  createSnapshot(name: string): HistorySnapshot {
    const snapshot: HistorySnapshot = {
      id: `snapshot-${Date.now()}`,
      name,
      timestamp: Date.now(),
      stackIndex: this.undoStack.length,
    };
    this.snapshots.push(snapshot);
    this.notify();
    return snapshot;
  }

  getSnapshots(): HistorySnapshot[] {
    return [...this.snapshots];
  }

  deleteSnapshot(id: string): boolean {
    const index = this.snapshots.findIndex((s) => s.id === id);
    if (index !== -1) {
      this.snapshots.splice(index, 1);
      this.notify();
      return true;
    }
    return false;
  }

  getDisplayHistory(): Array<{ entry: HistoryEntry; isCurrent: boolean }> {
    const result: Array<{ entry: HistoryEntry; isCurrent: boolean }> = [];
    const seen = new Set<string>();

    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const entry = this.undoStack[i];
      if (entry.groupId) {
        if (!seen.has(entry.groupId)) {
          seen.add(entry.groupId);
          result.push({ entry, isCurrent: i === this.undoStack.length - 1 });
        }
      } else {
        result.push({ entry, isCurrent: i === this.undoStack.length - 1 });
      }
    }
    return result.reverse();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getHistory(): Action[] {
    return this.undoStack.map((entry) => entry.action);
  }

  getHistoryEntries(): HistoryEntry[] {
    return [...this.undoStack];
  }

  getRedoEntries(): HistoryEntry[] {
    return [...this.redoStack];
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.snapshots = [];
    this.currentGroupId = null;
    this.notify();
  }

  getUndoStackSize(): number {
    return this.undoStack.length;
  }

  getRedoStackSize(): number {
    return this.redoStack.length;
  }

  peekUndo(): HistoryEntry | null {
    return this.undoStack.length > 0
      ? this.undoStack[this.undoStack.length - 1]
      : null;
  }

  peekRedo(): HistoryEntry | null {
    return this.redoStack.length > 0
      ? this.redoStack[this.redoStack.length - 1]
      : null;
  }

  getMaxHistorySize(): number {
    return this.maxHistorySize;
  }

  setMaxHistorySize(size: number): void {
    this.maxHistorySize = size;
    // Trim if necessary
    while (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }
  }
}
