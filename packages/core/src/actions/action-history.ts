import type { Action } from "../types/actions";

interface HistoryEntry {
  readonly action: Action;
  readonly inverseAction: Action | null;
  readonly timestamp: number;
  readonly description: string;
  readonly groupId?: string;
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
  "timeline/toolEdit": (params) => typeof params.label === "string" ? params.label : "Edit clip timing",
  "media/organize": (params) => typeof params.label === "string" ? params.label : "Organize media",
  "clip/add": () => "Add clip",
  "clip/remove": () => "Delete clip",
  "clip/move": () => "Move clip",
  "clip/addBatch": (params) => `Paste ${(params.clips as unknown[] | undefined)?.length ?? 0} clips`,
  "clip/removeBatch": (params) => `Delete ${(params.clipIds as unknown[] | undefined)?.length ?? 0} clips`,
  "clip/restoreBatch": (params) => `Restore ${(params.entries as unknown[] | undefined)?.length ?? 0} clips`,
  "clip/moveBatch": (params) => `Move ${(params.moves as unknown[] | undefined)?.length ?? 0} clips`,
  "clip/trim": () => "Trim clip",
  "clip/split": () => "Split clip",
  "clip/rippleDelete": () => "Ripple delete",
  "clip/duplicate": () => "Duplicate clip",
  "clip/setBlendMode": () => "Change blend mode",
  "clip/setBlendOpacity": () => "Adjust blend opacity",
  "clip/setEmphasisAnimation": () => "Set emphasis animation",
  "clip/setColorGrading": () => "Color grading",
  "track/add": (params) => `Add ${params.trackType} track`,
  "track/duplicate": () => "Duplicate track",
  "track/remove": () => "Remove track",
  "track/rename": () => "Rename track",
  "audioRack/set": (params) =>
    params.target === "master" ? "Edit master audio rack" : "Edit track audio rack",
  "audioPluginRack/set": () => "Edit audio plugin rack",
  "trackAutomation/set": (params) => `Edit track ${params.lane} automation`,
  "trackAutomation/record": () => "Record automation",
  "trackAutomation/setMode": (params) => `Set automation mode to ${String(params.mode)}`,
  "audioRouting/set": (params) => (typeof params.label === "string" && params.label ? params.label : "Edit audio routing"),
  "audioMixer/snapshot": (params) => (typeof params.label === "string" && params.label ? params.label : "Edit mixer snapshot"),
  "effect/add": (params) => `Add ${params.effectType} effect`,
  "effect/remove": () => "Remove effect",
  "effect/update": () => "Update effect",
  "effect/toggle": () => "Toggle effect",
  "effect/setStack": () => "Replace effect stack",
  "effect/setStackState": () => "Update effects and keyframes",
  "effectPreset/setAll": () => "Update effect presets",
  "transitionPreset/setLibrary": () => "Update transition presets",
  "transform/update": () => "Transform clip",
  "keyframe/add": (params) => `Add ${params.property} keyframe`,
  "keyframe/remove": () => "Remove keyframe",
  "keyframe/setAll": () => "Replace clip keyframes",
  "transition/add": (params) => `Add ${params.transitionType} transition`,
  "transition/set": () => "Add transition",
  "transition/update": () => "Update transition",
  "transition/remove": () => "Remove transition",
  "audio/setVolume": () => "Adjust volume",
  "audio/setFade": () => "Adjust fade",
  "audio/addEffect": () => "Add audio effect",
  "audio/removeEffect": () => "Remove audio effect",
  "audio/updateEffect": () => "Update audio effect",
  "audio/replaceEffect": () => "Update audio effect",
  "audio/toggleEffect": () => "Toggle audio effect",
  "audio/setEssentialSound": (params) => (params.audioType ? `Set audio type: ${params.audioType}` : "Clear audio type"),
  "audio/setSurroundPan": (params) => (params.pan ? "Set surround position" : "Reset surround position"),
  "audio/setChannelMap": (params) => (params.map ? "Modify audio channels" : "Reset audio channels"),
  "audio/restoreChannelMaps": () => "Modify audio channels",
  "audio/setLiveDucking": (params) => (params.config ? "Duck under dialogue" : "Remove ducking"),
  "subtitle/add": () => "Add subtitle",
  "subtitle/remove": () => "Remove subtitle",
  "marker/add": () => "Add marker",
  "marker/remove": () => "Remove marker",
  "marker/update": () => "Update marker",
  "project/rename": () => "Rename project",
  "project/updateSettings": () => "Update settings",
  "project/setCanvasBackground": () => "Change canvas background",
  "project/registerGeneratedShader": () => "Add generated shader",
  "project/removeGeneratedShader": () => "Remove generated shader",
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
  "audio/setSurroundPan",
  "audio/updateEffect",
  "transition/update",
  "clip/setBlendOpacity",
  "clip/setColorGrading",
  "clip/move",
  "clip/trim",
  "clip/slip",
  "clip/slide",
  "clip/roll",
  "clip/setSpeed",
  "clip/setChromaKey",
  "clip/setStabilization",
  "clip/setObjectRemoval",
  "keyframe/move",
  "keyframe/update",
  "project/updateSettings",
  "project/setCanvasBackground",
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

export interface AppliedActionEvent {
  readonly kind: "edit" | "undo" | "redo";
  readonly actions: readonly Action[];
}

export class ActionHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistorySize: number;
  private currentGroupId: string | null = null;
  private groupDepth = 0;
  private groupSequence = 0;
  private snapshots: HistorySnapshot[] = [];
  private listeners: Set<() => void> = new Set();
  private lastActionTime: number = 0;
  private autoGroupWindow: number = 100;
  private burstKey: string | null = null;
  private openingBurst = false;

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

  private appliedListeners = new Set<(event: AppliedActionEvent) => void>();

  /**
   * Observe every action this history's owner applied locally: edits (on push),
   * undos and redos. Remote (collaborator) actions never reach it.
   */
  subscribeApplied(listener: (event: AppliedActionEvent) => void): () => void {
    this.appliedListeners.add(listener);
    return () => this.appliedListeners.delete(listener);
  }

  notifyApplied(event: AppliedActionEvent): void {
    this.appliedListeners.forEach((listener) => listener(event));
  }

  /** Drop the entry (and its redo twin) for an action that was rolled back, e.g. rejected by a collaboration server. */
  discard(actionId: string): boolean {
    const before = this.undoStack.length + this.redoStack.length;
    this.undoStack = this.undoStack.filter((e) => e.action.id !== actionId);
    this.redoStack = this.redoStack.filter((e) => e.action.id !== actionId);
    const changed = this.undoStack.length + this.redoStack.length !== before;
    if (changed) this.notify();
    return changed;
  }

  push(action: Action, inverseAction: Action | null = null, invocationGroupId?: string | null): void {
    const now = Date.now();
    const timeSinceLastAction = now - this.lastActionTime;
    this.lastActionTime = now;

    // A coalescing burst (e.g. nudge keystrokes) only owns pushes carrying its
    // own key; any other action closes it so it can never merge into the burst.
    if (this.burstKey !== null) {
      const burstGroup = this.currentGroupId;
      const key = (action.params as Record<string, unknown> | undefined)?.burstKey;
      if (key !== this.burstKey) {
        this.endBurst();
        if (invocationGroupId === burstGroup) invocationGroupId = null;
      }
    }

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
    let groupId = invocationGroupId === undefined ? this.currentGroupId : invocationGroupId;
    if (
      !groupId &&
      lastEntry &&
      (!lastEntry.groupId || lastEntry.groupId.startsWith("auto-")) &&
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

    // Consecutive batches of one gesture (a drag of a big selection commits every frame) are one entry that
    // keeps the FIRST inverse (the pre-gesture state): memory stays O(1) per gesture, not O(frames x clips).
    const coalesceKey = (action.params as Record<string, unknown> | undefined)?.coalesceKey;
    if (typeof coalesceKey === "string" && lastEntry && groupId && lastEntry.groupId === groupId &&
        (lastEntry.action.params as Record<string, unknown> | undefined)?.coalesceKey === coalesceKey) {
      this.undoStack[this.undoStack.length - 1] = { ...lastEntry, action, timestamp: now };
      this.redoStack = [];
      this.notify();
      this.notifyApplied({ kind: "edit", actions: [action] });
      return;
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

    this.trimToMaxSize();

    this.notify();
    this.notifyApplied({ kind: "edit", actions: [action] });
  }

  /**
   * Drop the oldest history past the size limit, a whole undo step at a time. The limit counts undo steps: a
   * group (one user action made of many entries, like deleting 2000 clips or one drag) is a single step and is
   * never cut in the middle, because undoing half a group restores half an edit, nor does it push earlier
   * steps out of history. The newest step is always kept.
   */
  private trimToMaxSize(): void {
    const stack = this.undoStack;
    // Steps never outnumber entries: nothing to trim until the raw entry count passes the limit.
    if (stack.length <= this.maxHistorySize) return;
    const stepEnds: number[] = [];
    for (let i = 0; i < stack.length; i++) {
      const groupId = stack[i].groupId;
      if (!groupId || stack[i + 1]?.groupId !== groupId) stepEnds.push(i + 1);
    }
    let excess = stepEnds.length - this.maxHistorySize;
    if (excess <= 0) return;
    // Never drop the newest step.
    excess = Math.min(excess, stepEnds.length - 1);
    const drop = stepEnds[excess - 1];
    this.undoStack.splice(0, drop);
    this.snapshots = this.snapshots
      .map((s) => ({ ...s, stackIndex: s.stackIndex - drop }))
      .filter((s) => s.stackIndex >= 0);
  }

  beginGroup(_description?: string): string {
    // A transaction opened while a coalescing burst is live gets its own group,
    // so its first push is not detached from the rest of the transaction.
    if (this.burstKey !== null && !this.openingBurst) this.endBurst();
    if (this.currentGroupId) {
      this.groupDepth += 1;
      return this.currentGroupId;
    }
    this.currentGroupId = `group-${Date.now()}-${++this.groupSequence}`;
    this.groupDepth = 1;
    return this.currentGroupId;
  }

  /** Open a group that only pushes tagged `params.burstKey === key` may join. */
  beginBurst(key: string): void {
    if (this.burstKey === key) return;
    this.endBurst();
    this.openingBurst = true;
    try {
      this.beginGroup(key);
    } finally {
      this.openingBurst = false;
    }
    this.burstKey = key;
  }

  hasBurst(key?: string): boolean {
    return this.burstKey !== null && (key === undefined || this.burstKey === key);
  }

  endBurst(): void {
    if (this.burstKey === null) return;
    this.burstKey = null;
    this.endGroup();
  }

  getCurrentGroupId(): string | null {
    return this.currentGroupId;
  }

  endGroup(): void {
    if (this.groupDepth > 1) {
      this.groupDepth -= 1;
      return;
    }
    this.groupDepth = 0;
    this.currentGroupId = null;
    this.notify();
  }

  setAutoGroupWindow(ms: number): void {
    this.autoGroupWindow = ms;
  }

  undo(): Action | null {
    this.endBurst();
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
    this.endBurst();
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
    this.groupDepth = 0;
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
    this.trimToMaxSize();
  }
}
