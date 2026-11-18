import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ClipRecipe, ClipRecipeStep } from "../services/clip-recipes";

export const useClipRecipesStore = create<{
  recipes: ClipRecipe[];
  save: (name: string, steps: ClipRecipeStep[]) => void;
}>()(
  persist(
    (set) => ({
      recipes: [],
      save: (name, steps) =>
        set((state) => ({
          recipes: [
            ...state.recipes,
            {
              id: crypto.randomUUID(),
              name: name.trim() || "My recipe",
              steps: JSON.parse(JSON.stringify(steps)),
            },
          ],
        })),
    }),
    { name: "openreel-clip-recipes", version: 1 },
  ),
);
