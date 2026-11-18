import { create } from "zustand";
import type { LutLibraryEntry, SavedLook } from "@openreel/core";
import {
  deleteLookEntry,
  deleteLutEntry,
  listLooks,
  listLutEntries,
  saveLookEntry,
  saveLutEntry,
} from "../services/color-library";

/** In-memory view of the per-user IndexedDB colour library (LUTs and saved looks). */
interface ColorLibraryState {
  luts: LutLibraryEntry[];
  looks: SavedLook[];
  loaded: boolean;
  refresh: () => Promise<void>;
  addLut: (entry: LutLibraryEntry) => Promise<void>;
  removeLut: (id: string) => Promise<boolean>;
  addLook: (look: SavedLook) => Promise<void>;
  removeLook: (id: string) => Promise<boolean>;
}

export const useColorLibraryStore = create<ColorLibraryState>((set, get) => ({
  luts: [],
  looks: [],
  loaded: false,
  refresh: async () => {
    const [luts, looks] = await Promise.all([listLutEntries(), listLooks()]);
    set({ luts, looks, loaded: true });
  },
  addLut: async (entry) => {
    await saveLutEntry(entry);
    await get().refresh();
  },
  removeLut: async (id) => {
    const existed = get().luts.some((l) => l.id === id);
    await deleteLutEntry(id);
    await get().refresh();
    return existed;
  },
  addLook: async (look) => {
    await saveLookEntry(look);
    await get().refresh();
  },
  removeLook: async (id) => {
    const existed = get().looks.some((l) => l.id === id);
    await deleteLookEntry(id);
    await get().refresh();
    return existed;
  },
}));
