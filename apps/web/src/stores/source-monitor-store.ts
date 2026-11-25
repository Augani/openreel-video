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

/**
 * A clip shown in the Source monitor before it is part of the project (the Media Browser's preview).
 * It is read-only: nothing here can be edited into the timeline until it has been imported.
 */
export interface ExternalSourcePreview {
  id: string;
  name: string;
  blob: Blob;
  duration: number;
  frameRate?: number;
  width?: number;
  height?: number;
  type: "video" | "audio" | "image";
  hasAudio: boolean;
  /** Shown beside the name ("first 5 minutes only", "3 files joined"). */
  note?: string;
  /** The Import button of the preview banner. */
  onImport?: () => void;
}
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

const HISTORY_KEY = "openreel-source-history:";

interface PersistedHistory {
  history: string[];
  positions: Record<string, number>;
}

function readHistory(projectId: string): PersistedHistory {
  const empty: PersistedHistory = { history: [], positions: {} };
  try {
    const raw = localStorage.getItem(HISTORY_KEY + projectId);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as { history?: unknown; positions?: unknown } | null;
    if (!parsed || typeof parsed !== "object") return empty;
    const history = Array.isArray(parsed.history)
      ? parsed.history.filter((id): id is string => typeof id === "string").slice(0, SOURCE_HISTORY_LIMIT)
      : [];
    const positions: Record<string, number> = {};
    if (parsed.positions && typeof parsed.positions === "object") {
      for (const [id, v] of Object.entries(parsed.positions as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) positions[id] = v;
      }
    }
    return { history, positions };
  } catch {
    return empty;
  }
}

function writeHistory(projectId: string | null, history: readonly string[], positions: Record<string, number>) {
  if (!projectId) return;
  try {
    const kept: Record<string, number> = {};
    for (const id of history) if (positions[id] !== undefined) kept[id] = positions[id];
    localStorage.setItem(HISTORY_KEY + projectId, JSON.stringify({ history, positions: kept }));
  } catch {
    /* storage unavailable: history lasts for this session only */
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
  /** A not-yet-imported clip being previewed (the Media Browser); null for project media. */
  externalPreview: ExternalSourcePreview | null;
  /** Source playhead, seconds into the media. */
  position: number;
  /** Shuttle rate: 0 stopped, negative reverse. */
  rate: number;
  projectId: string | null;
  marks: Record<string, SourceMarks>;
  /** Recently loaded media ids, most recent first (this project; kept across reloads). */
  history: string[];
  /** Where each history clip's Source playhead was left, seconds. The loaded clip's live value is `position`. */
  positions: Record<string, number>;
  /** Bumped on every open request so the view can re-focus/seek. */
  openNonce: number;
  /** Replace edit keeps the replaced clip's effects, keyframes and audio
   * settings (on) or resets them to a fresh clip (off). */
  replaceKeepsAttributes: boolean;
  /** The Transcript tab (text-based editing of the loaded clip) is open under the Source picture. */
  transcriptOpen: boolean;

  setTranscriptOpen: (open: boolean) => void;
  setTab: (tab: MonitorTab) => void;
  setFocus: (focus: MonitorFocus) => void;
  setReplaceKeepsAttributes: (keep: boolean) => void;
  /** Preview a clip that is not in the project yet (read-only) and show the Source tab. */
  openExternal: (preview: ExternalSourcePreview) => void;
  closeExternal: () => void;
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
  /** The Source playhead a clip would reopen at: live for the loaded clip, else where it was left. */
  getRememberedPosition: (mediaId: string) => number | undefined;
}

export const useSourceMonitorStore = create<SourceMonitorState>((set, get) => ({
  tab: "program",
  focus: "program",
  mediaId: null,
  externalPreview: null,
  position: 0,
  rate: 0,
  projectId: null,
  marks: {},
  history: [],
  positions: {},
  openNonce: 0,
  replaceKeepsAttributes: true,
  transcriptOpen: false,

  setTranscriptOpen: (transcriptOpen) => set({ transcriptOpen, ...(transcriptOpen ? { tab: "source" as const, focus: "source" as const } : {}) }),
  setTab: (tab) => set({ tab, ...(tab === "program" ? { rate: 0, focus: "program" as const } : {}) }),
  setFocus: (focus) => set({ focus }),
  setReplaceKeepsAttributes: (replaceKeepsAttributes) => set({ replaceKeepsAttributes }),
  bindProject: (projectId) => {
    if (get().projectId === projectId) return;
    const saved = readHistory(projectId);
    set({ projectId, marks: readMarks(projectId), mediaId: null, externalPreview: null, position: 0, rate: 0, history: saved.history, positions: saved.positions });
  },
  openExternal: (preview) =>
    set((state) => ({ tab: "source", focus: "source", mediaId: preview.id, externalPreview: preview, position: 0, rate: 0, openNonce: state.openNonce + 1 })),
  closeExternal: () => set((state) => (state.externalPreview ? { externalPreview: null, mediaId: null, position: 0, rate: 0 } : {})),
  open: (mediaId, projectId, time) => {
    const state = get();
    const sameProject = state.projectId === projectId;
    // Leaving a project clip remembers where its playhead was; reopening it from history resumes there.
    const positions = { ...(sameProject ? state.positions : readHistory(projectId).positions) };
    if (sameProject && state.mediaId && !state.externalPreview) positions[state.mediaId] = state.position;
    const history = pushSourceHistory(sameProject ? state.history : readHistory(projectId).history, mediaId);
    writeHistory(projectId, history, positions);
    set({
      tab: "source",
      focus: "source",
      mediaId,
      externalPreview: null,
      position: Math.max(0, time ?? (state.mediaId === mediaId && sameProject && !state.externalPreview ? state.position : positions[mediaId] ?? 0)),
      rate: 0,
      projectId,
      marks: sameProject ? state.marks : readMarks(projectId),
      history,
      positions,
      openNonce: state.openNonce + 1,
    });
  },
  setPosition: (position) => set({ position: Math.max(0, position) }),
  setRate: (rate) => set({ rate }),
  shuttle: (direction) => set((s) => ({ rate: nextShuttleRate(s.rate, direction) })),
  stop: () => set({ rate: 0 }),
  togglePlay: () => set((s) => ({ rate: s.rate === 0 ? 1 : 0 })),
  forgetHistory: (mediaId) => {
    const s = get();
    const history = s.history.filter((id) => id !== mediaId);
    const positions = { ...s.positions };
    delete positions[mediaId];
    set({ history, positions });
    writeHistory(s.projectId, history, positions);
  },
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
  getRememberedPosition: (mediaId) => {
    const s = get();
    if (s.mediaId === mediaId && !s.externalPreview) return s.position;
    return s.positions[mediaId];
  },
}));

// A reload keeps the loaded clip's playhead too, not just those of clips left earlier.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    const s = useSourceMonitorStore.getState();
    if (!s.mediaId || s.externalPreview) return;
    writeHistory(s.projectId, s.history, { ...s.positions, [s.mediaId]: s.position });
  });
}
