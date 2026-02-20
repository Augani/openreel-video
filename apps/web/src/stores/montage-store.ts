import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MontageSettings {
  spliceMode: "random" | "sequential" | "full";
  minDuration: number;
  maxDuration: number;
  transition: string;
}

export interface MontagePreset {
  id: string;
  name: string;
  settings: MontageSettings;
}

export interface MontageState {
  sourceMediaIds: string[];
  settings: MontageSettings;
  presets: MontagePreset[];

  addSourceMedia: (mediaIds: string[]) => void;
  removeSourceMedia: (mediaId: string) => void;
  clearSourceMedia: () => void;
  updateSettings: (settings: Partial<MontageSettings>) => void;
  savePreset: (name: string) => void;
  loadPreset: (presetId: string) => void;
  deletePreset: (presetId: string) => void;
  shuffleSourceMedia: () => void;
}

const DEFAULT_SETTINGS: MontageSettings = {
  spliceMode: "random",
  minDuration: 2,
  maxDuration: 5,
  transition: "none",
};

export const useMontageStore = create<MontageState>()(
  persist(
    (set, get) => ({
      sourceMediaIds: [],
      settings: DEFAULT_SETTINGS,
      presets: [],

      addSourceMedia: (mediaIds) => {
        set((state) => ({
          sourceMediaIds: [...state.sourceMediaIds, ...mediaIds],
        }));
      },

      removeSourceMedia: (mediaId) => {
        set((state) => ({
          sourceMediaIds: state.sourceMediaIds.filter((id) => id !== mediaId),
        }));
      },

      clearSourceMedia: () => {
        set({ sourceMediaIds: [] });
      },

      updateSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
      },

      savePreset: (name) => {
        const { settings, presets } = get();
        const newPreset: MontagePreset = {
          id: Date.now().toString(),
          name,
          settings: { ...settings },
        };
        set({ presets: [...presets, newPreset] });
      },

      loadPreset: (presetId) => {
        const { presets } = get();
        const preset = presets.find((p) => p.id === presetId);
        if (preset) {
          set({ settings: { ...preset.settings } });
        }
      },

      deletePreset: (presetId) => {
        set((state) => ({
          presets: state.presets.filter((p) => p.id !== presetId),
        }));
      },

      shuffleSourceMedia: () => {
        set((state) => {
          const shuffled = [...state.sourceMediaIds].sort(
            () => Math.random() - 0.5,
          );
          return { sourceMediaIds: shuffled };
        });
      },
    }),
    {
      name: "montage-store",
      partialize: (state) => ({
        settings: state.settings,
        presets: state.presets,
        // Don't persist sourceMediaIds as media IDs might change or become invalid across sessions easily if not careful,
        // though persisting them could be nice. But project store handles media persistence.
        // If media is deleted from project, these IDs become invalid.
        // Let's persist them for now, but handle invalid IDs in UI.
        sourceMediaIds: state.sourceMediaIds,
      }),
    },
  ),
);
