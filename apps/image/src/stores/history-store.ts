import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Command } from '@openreel/image-core/commands';
import type { Project } from '../types/project';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;
}

interface CommandRecord {
  id: string;
  timestamp: number;
  command: Command;
}

interface Snapshot {
  id: string;
  name: string;
  timestamp: number;
  /** Serialised project state for this snapshot. */
  state: string;
  thumbnail?: string;
}

interface HistoryState {
  undoStack: CommandRecord[];
  redoStack: CommandRecord[];
  /** Serialised project state captured before the first command was recorded. */
  baseProject: string | null;
  maxSize: number;
  snapshots: Snapshot[];
}

interface HistoryActions {
  /**
   * Record and immediately apply `cmd` to `currentProject`.
   * Returns the updated project that callers must set into the project store.
   */
  execute: (cmd: Command, currentProject: Project) => Project;

  /**
   * Undo the most recent command.  Applies the inverse to `currentProject`
   * and returns the restored project, or `null` when nothing can be undone.
   */
  undo: (currentProject: Project) => Project | null;

  /**
   * Re-apply the most recently undone command to `currentProject`.
   * Returns the restored project or `null` when there is nothing to redo.
   */
  redo: (currentProject: Project) => Project | null;

  canUndo: () => boolean;
  canRedo: () => boolean;

  /**
   * Human-readable description of the command that would be undone next.
   */
  getUndoDescription: () => string | null;

  /**
   * Human-readable description of the command that would be redone next.
   */
  getRedoDescription: () => string | null;

  /**
   * Jump to an arbitrary position in the undo stack (0 = oldest, length-1 = newest).
   * Replays all commands from `baseProject` up to and including `index`.
   * Returns the project at that point or `null` on failure.
   */
  goToEntry: (index: number) => Project | null;

  /**
   * Derived list of entries for the HistoryPanel (newest first when reversed by consumer).
   */
  getEntries: () => HistoryEntry[];

  /** Current position: index of the entry that reflects the present project state. */
  getCurrentIndex: () => number;

  clear: (baseProject?: Project) => void;
  setMaxSize: (max: number) => void;

  // ── Named snapshots (checkpoint-style) ──────────────────────────────────

  createSnapshot: (name: string, project: Project, thumbnail?: string) => void;
  restoreSnapshot: (id: string) => Project | null;
  deleteSnapshot: (id: string) => void;
  renameSnapshot: (id: string, name: string) => void;
  getSnapshots: () => Snapshot[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useHistoryStore = create<HistoryState & HistoryActions>()(
  subscribeWithSelector((set, get) => ({
    undoStack: [],
    redoStack: [],
    baseProject: null,
    maxSize: 50,
    snapshots: [],

    execute: (cmd, currentProject) => {
      const { undoStack, maxSize, baseProject } = get();

      // Capture base project on first command ever.
      const base = baseProject ?? JSON.stringify(currentProject);

      // Attempt to coalesce with the most recent command via Command.merge.
      // Merge is called on the LAST (older) command with the NEW command as argument.
      if (undoStack.length > 0) {
        const last = undoStack[undoStack.length - 1];
        const merged = last.command.merge?.(cmd) ?? null;
        if (merged !== null) {
          const newProject = cmd.apply(currentProject);
          const updatedStack = [
            ...undoStack.slice(0, -1),
            { ...last, command: merged },
          ];
          set({
            undoStack: updatedStack,
            redoStack: [],
            baseProject: base,
          });
          return newProject;
        }
      }

      const newProject = cmd.apply(currentProject);

      const record: CommandRecord = {
        id: generateId(),
        timestamp: Date.now(),
        command: cmd,
      };

      let newStack = [...undoStack, record];
      if (newStack.length > maxSize) {
        // When we drop the oldest command we need to update baseProject to
        // the state *after* that command would have been applied so that
        // goToEntry remains correct.  We approximate by re-serialising the
        // project state that preceded the second-oldest command (i.e. we
        // compute the new base by applying the dropped command to the old
        // base and serialising that result).
        const dropped = newStack[0];
        let newBase: Project | null = null;
        try {
          const parsed = JSON.parse(base) as Project;
          newBase = dropped.command.apply(parsed);
        } catch {
          newBase = null;
        }
        newStack = newStack.slice(1);
        set({
          undoStack: newStack,
          redoStack: [],
          baseProject: newBase ? JSON.stringify(newBase) : base,
        });
      } else {
        set({ undoStack: newStack, redoStack: [], baseProject: base });
      }

      return newProject;
    },

    undo: (currentProject) => {
      const { undoStack, redoStack } = get();
      if (undoStack.length === 0) return null;

      const record = undoStack[undoStack.length - 1];
      const inverse = record.command.invert();
      const restoredProject = inverse.apply(currentProject);

      set({
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack, record],
      });

      return restoredProject;
    },

    redo: (currentProject) => {
      const { undoStack, redoStack } = get();
      if (redoStack.length === 0) return null;

      const record = redoStack[redoStack.length - 1];
      const newProject = record.command.apply(currentProject);

      set({
        undoStack: [...undoStack, record],
        redoStack: redoStack.slice(0, -1),
      });

      return newProject;
    },

    canUndo: () => get().undoStack.length > 0,
    canRedo: () => get().redoStack.length > 0,

    getUndoDescription: () => {
      const { undoStack } = get();
      return undoStack.length > 0 ? undoStack[undoStack.length - 1].command.description : null;
    },

    getRedoDescription: () => {
      const { redoStack } = get();
      return redoStack.length > 0 ? redoStack[redoStack.length - 1].command.description : null;
    },

    goToEntry: (index) => {
      const { undoStack, baseProject } = get();
      if (index < 0 || index >= undoStack.length) return null;
      if (!baseProject) return null;

      try {
        let project = JSON.parse(baseProject) as Project;
        for (let i = 0; i <= index; i++) {
          project = undoStack[i].command.apply(project);
        }
        // Commands past the target index become the redo stack, reversed so that
        // the next command to re-apply (index+1) is at the end (popped first on redo).
        const redoCommands = undoStack.slice(index + 1).reverse();
        set({ undoStack: undoStack.slice(0, index + 1), redoStack: redoCommands });
        return project;
      } catch {
        return null;
      }
    },

    getEntries: () =>
      get().undoStack.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        description: r.command.description,
      })),

    getCurrentIndex: () => get().undoStack.length - 1,

    clear: (baseProject) => {
      set({
        undoStack: [],
        redoStack: [],
        baseProject: baseProject ? JSON.stringify(baseProject) : null,
      });
    },

    setMaxSize: (max) => set({ maxSize: max }),

    // ── Named snapshots ────────────────────────────────────────────────────

    createSnapshot: (name, project, thumbnail) => {
      const { snapshots } = get();
      const snapshot: Snapshot = {
        id: generateId(),
        name,
        timestamp: Date.now(),
        state: JSON.stringify(project),
        thumbnail,
      };
      set({ snapshots: [...snapshots, snapshot] });
    },

    restoreSnapshot: (id) => {
      const { snapshots } = get();
      const snapshot = snapshots.find((s) => s.id === id);
      if (!snapshot) return null;
      try {
        return JSON.parse(snapshot.state) as Project;
      } catch {
        return null;
      }
    },

    deleteSnapshot: (id) => {
      set({ snapshots: get().snapshots.filter((s) => s.id !== id) });
    },

    renameSnapshot: (id, name) => {
      set({
        snapshots: get().snapshots.map((s) => (s.id === id ? { ...s, name } : s)),
      });
    },

    getSnapshots: () => get().snapshots,
  }))
);
