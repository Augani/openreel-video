import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Project } from '../types/project';

interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;
  state: string;
  thumbnail?: string;
}

interface Snapshot {
  id: string;
  name: string;
  timestamp: number;
  state: string;
  thumbnail?: string;
}

interface HistoryState {
  entries: HistoryEntry[];
  currentIndex: number;
  maxEntries: number;
  isUndoing: boolean;
  isRedoing: boolean;
  snapshots: Snapshot[];
}

interface HistoryActions {
  pushState: (project: Project, description: string, thumbnail?: string) => void;
  undo: () => Project | null;
  redo: () => Project | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  setMaxEntries: (max: number) => void;
  getUndoDescription: () => string | null;
  getRedoDescription: () => string | null;
  createSnapshot: (name: string, project: Project, thumbnail?: string) => void;
  restoreSnapshot: (id: string) => Project | null;
  deleteSnapshot: (id: string) => void;
  renameSnapshot: (id: string, name: string) => void;
  getSnapshots: () => Snapshot[];
  getEntries: () => HistoryEntry[];
  goToEntry: (index: number) => Project | null;
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

export const useHistoryStore = create<HistoryState & HistoryActions>()(
  subscribeWithSelector((set, get) => ({
    entries: [],
    currentIndex: -1,
    maxEntries: 50,
    isUndoing: false,
    isRedoing: false,
    snapshots: [],

    pushState: (project, description, thumbnail) => {
      const { entries, currentIndex, maxEntries, isUndoing, isRedoing } = get();

      if (isUndoing || isRedoing) return;

      const newEntry: HistoryEntry = {
        id: generateId(),
        timestamp: Date.now(),
        description,
        state: JSON.stringify(project),
        thumbnail,
      };

      let newEntries = entries.slice(0, currentIndex + 1);
      newEntries.push(newEntry);

      if (newEntries.length > maxEntries) {
        newEntries = newEntries.slice(newEntries.length - maxEntries);
      }

      set({
        entries: newEntries,
        currentIndex: newEntries.length - 1,
      });
    },

    undo: () => {
      const { entries, currentIndex } = get();
      if (currentIndex <= 0) return null;

      set({ isUndoing: true });
      const newIndex = currentIndex - 1;
      const entry = entries[newIndex];

      set({ currentIndex: newIndex, isUndoing: false });
      return JSON.parse(entry.state) as Project;
    },

    redo: () => {
      const { entries, currentIndex } = get();
      if (currentIndex >= entries.length - 1) return null;

      set({ isRedoing: true });
      const newIndex = currentIndex + 1;
      const entry = entries[newIndex];

      set({ currentIndex: newIndex, isRedoing: false });
      return JSON.parse(entry.state) as Project;
    },

    canUndo: () => {
      const { currentIndex } = get();
      return currentIndex > 0;
    },

    canRedo: () => {
      const { entries, currentIndex } = get();
      return currentIndex < entries.length - 1;
    },

    clear: () => {
      set({ entries: [], currentIndex: -1 });
    },

    setMaxEntries: (max) => {
      set({ maxEntries: max });
    },

    getUndoDescription: () => {
      const { entries, currentIndex } = get();
      if (currentIndex > 0) {
        return entries[currentIndex].description;
      }
      return null;
    },

    getRedoDescription: () => {
      const { entries, currentIndex } = get();
      if (currentIndex < entries.length - 1) {
        return entries[currentIndex + 1].description;
      }
      return null;
    },

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
      return JSON.parse(snapshot.state) as Project;
    },

    deleteSnapshot: (id) => {
      const { snapshots } = get();
      set({ snapshots: snapshots.filter((s) => s.id !== id) });
    },

    renameSnapshot: (id, name) => {
      const { snapshots } = get();
      set({
        snapshots: snapshots.map((s) => (s.id === id ? { ...s, name } : s)),
      });
    },

    getSnapshots: () => {
      return get().snapshots;
    },

    getEntries: () => {
      return get().entries;
    },

    goToEntry: (index) => {
      const { entries } = get();
      if (index < 0 || index >= entries.length) return null;
      set({ currentIndex: index });
      return JSON.parse(entries[index].state) as Project;
    },
  }))
);
