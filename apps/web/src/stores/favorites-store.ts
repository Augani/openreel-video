import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Library kinds that support pinning favourites and remembering recent picks. */
export type FavoriteKind = "font" | "music" | "sfx" | (string & {});

export const MAX_RECENTS = 8;

interface FavoritesState {
  favorites: Record<string, string[]>;
  recents: Record<string, string[]>;
  toggleFavorite: (kind: FavoriteKind, id: string) => void;
  pushRecent: (kind: FavoriteKind, id: string) => void;
  clearRecents: (kind: FavoriteKind) => void;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set) => ({
      favorites: {},
      recents: {},
      toggleFavorite: (kind, id) =>
        set((state) => {
          const current = state.favorites[kind] ?? [];
          const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
          return { favorites: { ...state.favorites, [kind]: next } };
        }),
      pushRecent: (kind, id) =>
        set((state) => {
          const current = state.recents[kind] ?? [];
          if (current[0] === id) return state;
          const next = [id, ...current.filter((item) => item !== id)].slice(0, MAX_RECENTS);
          return { recents: { ...state.recents, [kind]: next } };
        }),
      clearRecents: (kind) => set((state) => ({ recents: { ...state.recents, [kind]: [] } })),
    }),
    { name: "openreel-favorites", version: 1 },
  ),
);

const EMPTY: readonly string[] = [];

export function useFavorites(kind: FavoriteKind): readonly string[] {
  return useFavoritesStore((state) => state.favorites[kind] ?? EMPTY);
}

export function useRecents(kind: FavoriteKind): readonly string[] {
  return useFavoritesStore((state) => state.recents[kind] ?? EMPTY);
}

/** Stable sort that moves favourites to the front, keeping the original order otherwise. */
export function pinFavorites<T>(items: readonly T[], idOf: (item: T) => string, favorites: readonly string[]): T[] {
  if (!favorites.length) return [...items];
  const pinned = new Set(favorites);
  return [...items.filter((item) => pinned.has(idOf(item))), ...items.filter((item) => !pinned.has(idOf(item)))];
}
