import { create } from "zustand";
import {
  DEFAULT_VISIBLE_COLUMNS,
  isMediaColumnId,
  type MediaColumnId,
  type SortDirection,
} from "@openreel/core";

/**
 * Project (media) panel view state: current bin, grid/list, sort, search and
 * visible columns. Pure UI state, never part of the project or its undo stack.
 * Layout preferences persist per browser; navigation state does not.
 */

export type ProjectPanelView = "grid" | "list";

export interface ProjectPanelSort {
  readonly column: MediaColumnId;
  readonly direction: SortDirection;
}

interface Prefs {
  view: ProjectPanelView;
  columns: MediaColumnId[];
  sort: ProjectPanelSort | null;
  searchColumn: MediaColumnId | "all";
}

const PREFS_KEY = "openreel-project-panel-prefs";

const DEFAULT_PREFS: Prefs = {
  view: "grid",
  columns: [...DEFAULT_VISIBLE_COLUMNS],
  sort: null,
  searchColumn: "all",
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const columns = Array.isArray(parsed.columns)
      ? parsed.columns.filter(isMediaColumnId)
      : DEFAULT_PREFS.columns;
    const sort =
      parsed.sort && isMediaColumnId(parsed.sort.column) && (parsed.sort.direction === "asc" || parsed.sort.direction === "desc")
        ? parsed.sort
        : null;
    return {
      view: parsed.view === "list" ? "list" : "grid",
      columns: columns.includes("name") ? columns : ["name", ...columns],
      sort,
      searchColumn: parsed.searchColumn === "all" || isMediaColumnId(parsed.searchColumn) ? parsed.searchColumn : "all",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: preferences just do not persist */
  }
}

export interface ProjectPanelTimings {
  readonly items: number;
  readonly filterMs: number;
  readonly sortMs: number;
  readonly at: number;
}

export type ProjectPanelDialog =
  | { kind: "rename-media"; mediaId: string }
  | { kind: "comment"; mediaId: string }
  | { kind: "description"; mediaId: string }
  | { kind: "scene" | "shot" | "take"; mediaId: string }
  | { kind: "interpret-footage"; mediaId: string }
  | { kind: "raw-settings"; mediaId: string }
  | { kind: "delete-bin"; binId: string }
  | { kind: "rename-smart-bin"; smartBinId: string };

interface ProjectPanelState extends Prefs {
  /** A bin being named before it exists; committing creates it in one undo step. */
  pendingBin: { parentId: string | null; mediaIds: string[] } | null;
  setPendingBin: (pending: { parentId: string | null; mediaIds: string[] } | null) => void;
  dialog: ProjectPanelDialog | null;
  openDialog: (dialog: ProjectPanelDialog | null) => void;
  /** Bin being viewed; null is the project root. */
  currentBinId: string | null;
  query: string;
  /** Smart bin being viewed (a saved search); null shows bins as usual. */
  activeSmartBinId: string | null;
  openSmartBin: (id: string | null) => void;
  /** Bumped by Cmd/Ctrl+F in the panel: the search field focuses and selects on change. */
  findNonce: number;
  requestFind: () => void;
  /** Bin currently being renamed inline. */
  renamingBinId: string | null;
  /** Selected bin tiles / rows (media selection lives in the UI store). */
  selectedBinIds: string[];
  /** Reveal-in-project request (nonce bumps so repeats re-trigger). */
  revealMediaId: string | null;
  revealNonce: number;
  /** Latest derived-data timings, for diagnostics and the e2e perf report. */
  timings: ProjectPanelTimings | null;

  setView: (view: ProjectPanelView) => void;
  setSort: (sort: ProjectPanelSort | null) => void;
  /** Click on a column header: asc, then desc, then back to the default order. */
  cycleSort: (column: MediaColumnId) => void;
  toggleColumn: (column: MediaColumnId) => void;
  setSearchColumn: (column: MediaColumnId | "all") => void;
  setQuery: (query: string) => void;
  openBin: (binId: string | null) => void;
  setRenamingBin: (binId: string | null) => void;
  setSelectedBins: (ids: string[]) => void;
  requestReveal: (mediaId: string, binId: string | null) => void;
  setTimings: (timings: ProjectPanelTimings) => void;
  reset: () => void;
}

const prefsOf = (s: ProjectPanelState): Prefs => ({
  view: s.view,
  columns: s.columns,
  sort: s.sort,
  searchColumn: s.searchColumn,
});

export const useProjectPanelStore = create<ProjectPanelState>((set, get) => ({
  ...loadPrefs(),
  currentBinId: null,
  activeSmartBinId: null,
  openSmartBin: (activeSmartBinId) => set({ activeSmartBinId, ...(activeSmartBinId ? { currentBinId: null, query: "", selectedBinIds: [] } : {}) }),
  findNonce: 0,
  requestFind: () => set((s) => ({ findNonce: s.findNonce + 1 })),
  query: "",
  renamingBinId: null,
  selectedBinIds: [],
  revealMediaId: null,
  revealNonce: 0,
  timings: null,
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  pendingBin: null,
  setPendingBin: (pendingBin) => set({ pendingBin }),

  setView: (view) => {
    set({ view });
    savePrefs(prefsOf(get()));
  },
  setSort: (sort) => {
    set({ sort });
    savePrefs(prefsOf(get()));
  },
  cycleSort: (column) => {
    const { sort } = get();
    const next: ProjectPanelSort | null =
      !sort || sort.column !== column
        ? { column, direction: "asc" }
        : sort.direction === "asc"
          ? { column, direction: "desc" }
          : null;
    set({ sort: next });
    savePrefs(prefsOf(get()));
  },
  toggleColumn: (column) => {
    if (column === "name") return;
    const { columns } = get();
    const next = columns.includes(column)
      ? columns.filter((c) => c !== column)
      : // Keep the canonical column order regardless of toggle order.
        (["name", "label", "type", "duration", "frameRate", "resolution", "codec", "audio", "fileSize", "importedAt", "usage", "comment", "description", "scene", "shot", "take", "goodTake"] as MediaColumnId[]).filter(
          (c) => c === column || columns.includes(c),
        );
    set({ columns: next });
    savePrefs(prefsOf(get()));
  },
  setSearchColumn: (searchColumn) => {
    set({ searchColumn });
    savePrefs(prefsOf(get()));
  },
  setQuery: (query) => set({ query }),
  openBin: (binId) => set({ currentBinId: binId, activeSmartBinId: null, selectedBinIds: [], renamingBinId: null }),
  setRenamingBin: (renamingBinId) => set({ renamingBinId }),
  setSelectedBins: (selectedBinIds) => set({ selectedBinIds }),
  requestReveal: (mediaId, binId) =>
    set((s) => ({
      currentBinId: binId,
      activeSmartBinId: null,
      query: "",
      selectedBinIds: [],
      revealMediaId: mediaId,
      revealNonce: s.revealNonce + 1,
    })),
  setTimings: (timings) => set({ timings }),
  reset: () => set({ currentBinId: null, activeSmartBinId: null, query: "", renamingBinId: null, selectedBinIds: [], revealMediaId: null }),
}));
