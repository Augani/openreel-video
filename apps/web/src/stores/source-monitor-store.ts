import { create } from "zustand";

/**
 * State of the Source monitor: which media is loaded, its own playhead, and
 * its own In/Out marks (kept per media item, per project).
 *
 * Marks are browser-persisted (localStorage, keyed by project id) so they
 * survive reloads and are independent of the sequence In/Out (the timeline
 * loop range). They are not timeline edits, so they never touch undo history.
 */
export interface SourceMarks {
  in?: number;
  out?: number;
}

export type MonitorTab = "program" | "source" | "multicam";
export type MonitorFocus = "program" | "source";

const MARKS_KEY = "openreel-source-marks:";
/** Premiere's Source monitor keeps a short most-recent-first list of loaded clips. */
export const SOURCE_HISTORY_LIMIT = 10;

/** Push `mediaId` to the front of a history list, de-duplicated and capped. */
export function pushSourceHistory(history: readonly string[], mediaId: string): string[] {
  return [mediaId, ...history.filter((id) => id !== mediaId)].slice(0, SOURCE_HISTORY_LIMIT);
}

function readMarks(projectId: string): Record<string, SourceMarks> {
  try {
    const raw = localStorage.getItem(MARKS_KEY + projectId);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, SourceMarks> = {};
    for (const [mediaId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const { in: a, out: b } = value as { in?: unknown; out?: unknown };
      const marks: SourceMarks = {};
      if (typeof a === "number" && Number.isFinite(a) && a >= 0) marks.in = a;
      if (typeof b === "number" && Number.isFinite(b) && b >= 0) marks.out = b;
      if (marks.in !== undefined || marks.out !== undefined) out[mediaId] = marks;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMarks(projectId: string, marks: Record<string, SourceMarks>) {
  try {
    localStorage.setItem(MARKS_KEY + projectId, JSON.stringify(marks));
  } catch {
    /* storage unavailable: marks last for this session only */
  }
}

/** Next shuttle rate for J (-1) / L (+1): 1x, 2x, 4x in each direction. */
export function nextShuttleRate(current: number, direction: -1 | 1): number {
  if (direction === 1) return current <= 0 ? 1 : Math.min(4, current * 2);
  return current >= 0 ? -1 : Math.max(-4, current * 2);
}

interface SourceMonitorState {
  /** Which monitor tab is showing. */
  tab: MonitorTab;
  /** Which monitor keyboard shortcuts act on. */
  focus: MonitorFocus;
  mediaId: string | null;
  /** Source playhead, seconds into the media. */
  position: number;
  /** Shuttle rate: 0 stopped, negative reverse. */
  rate: number;
  projectId: string | null;
  marks: Record<string, SourceMarks>;
  /** Recently loaded media ids, most recent first (this project, this session). */
  history: string[];
  /** Bumped on every open request so the view can re-focus/seek. */
  openNonce: number;
  /** Replace edit keeps the replaced clip's effects, keyframes and audio
   * settings (on) or resets them to a fresh clip (off). */
  replaceKeepsAttributes: boolean;

  setTab: (tab: MonitorTab) => void;
  setFocus: (focus: MonitorFocus) => void;
  setReplaceKeepsAttributes: (keep: boolean) => void;
  /** Load a media item into the source monitor and show the Source tab. */
  open: (mediaId: string, projectId: string, time?: number) => void;
  setPosition: (seconds: number) => void;
  setRate: (rate: number) => void;
  shuttle: (direction: -1 | 1) => void;
  stop: () => void;
  togglePlay: () => void;
  bindProject: (projectId: string) => void;
  /** Drop a media id (deleted from the project) from the history. */
  forgetHistory: (mediaId: string) => void;
  setMark: (mediaId: string, which: "in" | "out", seconds: number | null) => void;
  clearMarks: (mediaId: string) => void;
  getMarks: (mediaId: string) => SourceMarks;
}

export const useSourceMonitorStore = create<SourceMonitorState>((set, get) => ({
  tab: "program",
  focus: "program",
  mediaId: null,
  position: 0,
  rate: 0,
  projectId: null,
  marks: {},
  history: [],
  openNonce: 0,
  replaceKeepsAttributes: true,

  setTab: (tab) => set({ tab, ...(tab === "program" ? { rate: 0, focus: "program" as const } : {}) }),
  setFocus: (focus) => set({ focus }),
  setReplaceKeepsAttributes: (replaceKeepsAttributes) => set({ replaceKeepsAttributes }),
  bindProject: (projectId) => {
    if (get().projectId === projectId) return;
    set({ projectId, marks: readMarks(projectId), mediaId: null, position: 0, rate: 0, history: [] });
  },
  open: (mediaId, projectId, time) => {
    const state = get();
    const sameProject = state.projectId === projectId;
    set({
      tab: "source",
      focus: "source",
      mediaId,
      position: Math.max(0, time ?? (state.mediaId === mediaId && sameProject ? state.position : 0)),
      rate: 0,
      projectId,
      marks: sameProject ? state.marks : readMarks(projectId),
      history: pushSourceHistory(sameProject ? state.history : [], mediaId),
      openNonce: state.openNonce + 1,
    });
  },
  setPosition: (position) => set({ position: Math.max(0, position) }),
  setRate: (rate) => set({ rate }),
  shuttle: (direction) => set((s) => ({ rate: nextShuttleRate(s.rate, direction) })),
  stop: () => set({ rate: 0 }),
  togglePlay: () => set((s) => ({ rate: s.rate === 0 ? 1 : 0 })),
  forgetHistory: (mediaId) => set((s) => ({ history: s.history.filter((id) => id !== mediaId) })),
  setMark: (mediaId, which, seconds) => {
    const { marks, projectId } = get();
    const current = { ...(marks[mediaId] ?? {}) };
    if (seconds === null) delete current[which];
    else {
      current[which] = Math.max(0, seconds);
      // Keep In before Out: a new mark that crosses the other drops it.
      if (which === "in" && current.out !== undefined && current.out <= current.in!) delete current.out;
      if (which === "out" && current.in !== undefined && current.in >= current.out!) delete current.in;
    }
    const next = { ...marks };
    if (current.in === undefined && current.out === undefined) delete next[mediaId];
    else next[mediaId] = current;
    set({ marks: next });
    if (projectId) writeMarks(projectId, next);
  },
  clearMarks: (mediaId) => {
    const { marks, projectId } = get();
    if (!marks[mediaId]) return;
    const next = { ...marks };
    delete next[mediaId];
    set({ marks: next });
    if (projectId) writeMarks(projectId, next);
  },
  getMarks: (mediaId) => get().marks[mediaId] ?? {},
}));
