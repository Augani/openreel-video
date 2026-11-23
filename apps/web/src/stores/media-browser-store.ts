import { create } from "zustand";
import type { OpenReelBrowserEntry, OpenReelBrowserListing } from "../types/global";

export type BrowserView = "icons" | "list";
export type BrowserTypeFilter = "all" | "video" | "audio" | "image";

export interface BrowserFavourite {
  name: string;
  path: string;
}

const PREFS_KEY = "openreel-media-browser";

interface Prefs {
  view: BrowserView;
  favourites: BrowserFavourite[];
  lastPath: string | null;
}

function readPrefs(): Prefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return {
      view: parsed.view === "list" ? "list" : "icons",
      favourites: Array.isArray(parsed.favourites) ? parsed.favourites.filter((f): f is BrowserFavourite => !!f && typeof f.path === "string" && typeof f.name === "string").slice(0, 50) : [],
      lastPath: typeof parsed.lastPath === "string" ? parsed.lastPath : null,
    };
  } catch {
    return { view: "icons", favourites: [], lastPath: null };
  }
}
function writePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: preferences last for this session */
  }
}

/** Entries after the type filter and search (folders always stay unless a search is active). */
export function visibleEntries(listing: OpenReelBrowserListing | null, filter: BrowserTypeFilter, query: string): OpenReelBrowserEntry[] {
  if (!listing) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return listing.entries.filter((entry) => {
    if (filter !== "all" && entry.kind !== "dir" && entry.mediaType !== filter) return false;
    if (filter !== "all" && entry.kind === "dir") return terms.length === 0;
    const haystack = `${entry.name} ${entry.clip?.kind ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

interface MediaBrowserState {
  path: string | null;
  listing: OpenReelBrowserListing | null;
  loading: boolean;
  /** Show a camera card's folders instead of its clips. */
  rawFolders: boolean;
  view: BrowserView;
  typeFilter: BrowserTypeFilter;
  query: string;
  favourites: BrowserFavourite[];
  /** Selected entry ids, in click order. */
  selected: string[];
  anchor: string | null;
  importing: boolean;
  importMessage: string;
  setPath: (path: string | null) => void;
  setListing: (listing: OpenReelBrowserListing | null) => void;
  setLoading: (loading: boolean) => void;
  setRawFolders: (raw: boolean) => void;
  setView: (view: BrowserView) => void;
  setTypeFilter: (filter: BrowserTypeFilter) => void;
  setQuery: (query: string) => void;
  toggleFavourite: (favourite: BrowserFavourite) => void;
  select: (id: string, mode: "replace" | "toggle" | "range", ordered: readonly string[]) => void;
  clearSelection: () => void;
  selectAll: (ids: readonly string[]) => void;
  setImporting: (importing: boolean, message?: string) => void;
}

const initial = readPrefs();

export const useMediaBrowserStore = create<MediaBrowserState>((set, get) => ({
  path: null,
  listing: null,
  loading: false,
  rawFolders: false,
  view: initial.view,
  typeFilter: "all",
  query: "",
  favourites: initial.favourites,
  selected: [],
  anchor: null,
  importing: false,
  importMessage: "",
  setPath: (path) => {
    set({ path, selected: [], anchor: null });
    const { view, favourites } = get();
    writePrefs({ view, favourites, lastPath: path });
  },
  setListing: (listing) => set({ listing }),
  setLoading: (loading) => set({ loading }),
  setRawFolders: (rawFolders) => set({ rawFolders, selected: [], anchor: null }),
  setView: (view) => {
    set({ view });
    writePrefs({ view, favourites: get().favourites, lastPath: get().path });
  },
  setTypeFilter: (typeFilter) => set({ typeFilter }),
  setQuery: (query) => set({ query }),
  toggleFavourite: (favourite) => {
    const { favourites, view, path } = get();
    const next = favourites.some((f) => f.path === favourite.path) ? favourites.filter((f) => f.path !== favourite.path) : [...favourites, favourite];
    set({ favourites: next });
    writePrefs({ view, favourites: next, lastPath: path });
  },
  select: (id, mode, ordered) => {
    const { selected, anchor } = get();
    if (mode === "toggle") {
      set({ selected: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id], anchor: id });
    } else if (mode === "range" && anchor && ordered.includes(anchor)) {
      const a = ordered.indexOf(anchor);
      const b = ordered.indexOf(id);
      set({ selected: ordered.slice(Math.min(a, b), Math.max(a, b) + 1) });
    } else set({ selected: [id], anchor: id });
  },
  clearSelection: () => set({ selected: [], anchor: null }),
  selectAll: (ids) => set({ selected: [...ids] }),
  setImporting: (importing, importMessage = "") => set({ importing, importMessage }),
}));
