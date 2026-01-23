import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CustomPalette {
  id: string;
  name: string;
  colors: string[];
}

interface ColorState {
  recentColors: string[];
  savedColors: string[];
  customPalettes: CustomPalette[];
}

interface ColorActions {
  addRecentColor: (color: string) => void;
  saveColor: (color: string) => void;
  removeSavedColor: (color: string) => void;
  clearSavedColors: () => void;
  createPalette: (name: string, colors?: string[]) => string;
  updatePalette: (id: string, updates: Partial<Omit<CustomPalette, 'id'>>) => void;
  addColorToPalette: (paletteId: string, color: string) => void;
  removeColorFromPalette: (paletteId: string, color: string) => void;
  deletePalette: (id: string) => void;
}

const MAX_RECENT_COLORS = 12;
const MAX_SAVED_COLORS = 24;

const generateId = () => `palette_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const useColorStore = create<ColorState & ColorActions>()(
  persist(
    (set) => ({
      recentColors: [],
      savedColors: [],
      customPalettes: [],

      addRecentColor: (color) => {
        const normalized = color.toLowerCase();
        set((state) => {
          const filtered = state.recentColors.filter((c) => c.toLowerCase() !== normalized);
          return {
            recentColors: [color, ...filtered].slice(0, MAX_RECENT_COLORS),
          };
        });
      },

      saveColor: (color) => {
        const normalized = color.toLowerCase();
        set((state) => {
          if (state.savedColors.some((c) => c.toLowerCase() === normalized)) {
            return state;
          }
          return {
            savedColors: [...state.savedColors, color].slice(-MAX_SAVED_COLORS),
          };
        });
      },

      removeSavedColor: (color) => {
        const normalized = color.toLowerCase();
        set((state) => ({
          savedColors: state.savedColors.filter((c) => c.toLowerCase() !== normalized),
        }));
      },

      clearSavedColors: () => set({ savedColors: [] }),

      createPalette: (name, colors = []) => {
        const id = generateId();
        set((state) => ({
          customPalettes: [...state.customPalettes, { id, name, colors }],
        }));
        return id;
      },

      updatePalette: (id, updates) => {
        set((state) => ({
          customPalettes: state.customPalettes.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }));
      },

      addColorToPalette: (paletteId, color) => {
        const normalized = color.toLowerCase();
        set((state) => ({
          customPalettes: state.customPalettes.map((p) => {
            if (p.id !== paletteId) return p;
            if (p.colors.some((c) => c.toLowerCase() === normalized)) return p;
            return { ...p, colors: [...p.colors, color] };
          }),
        }));
      },

      removeColorFromPalette: (paletteId, color) => {
        const normalized = color.toLowerCase();
        set((state) => ({
          customPalettes: state.customPalettes.map((p) => {
            if (p.id !== paletteId) return p;
            return { ...p, colors: p.colors.filter((c) => c.toLowerCase() !== normalized) };
          }),
        }));
      },

      deletePalette: (id) => {
        set((state) => ({
          customPalettes: state.customPalettes.filter((p) => p.id !== id),
        }));
      },
    }),
    {
      name: 'openreel-image-colors',
    }
  )
);
