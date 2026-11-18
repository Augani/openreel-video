/**
 * Dock workspaces: named editor layouts (Editing, Color, Audio, and ones the user saves).
 *
 * The live dock geometry (column widths, timeline height) used to be component state in
 * EditorInterface; it lives here so a workspace can be captured, applied, renamed and deleted. A
 * workspace also remembers which asset browser section is showing and whether the audio mixer and
 * the AI chat are open. Everything is persisted to the user's own profile (localStorage), so each
 * OS user / browser profile keeps its own layouts. Layouts are UI preferences, not project data, so
 * they deliberately do not go through the undoable action system.
 */
import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEditorWorkspaceStore, type AssetSection } from "./editor-workspace-store";
import { useUIStore } from "./ui-store";

export const DEFAULT_TIMELINE_VH = (321 / 900) * 100;
export const MIN_TIMELINE_VH = 22;
export const MAX_TIMELINE_VH = 70;
export const DEFAULT_MEDIA_W = 300;
export const MIN_MEDIA_W = 240;
export const MAX_MEDIA_W = 640;
export const DEFAULT_INSPECTOR_W = 320;
export const MIN_INSPECTOR_W = 280;
export const MAX_INSPECTOR_W = 560;
export const DEFAULT_CHAT_W = 400;
export const MIN_CHAT_W = 320;
export const MAX_CHAT_W = 560;

export interface DockLayout {
  readonly mediaWidth: number;
  readonly inspectorWidth: number;
  readonly chatWidth: number;
  readonly timelineVh: number;
  readonly section: AssetSection;
  readonly mixerOpen: boolean;
  readonly chatOpen: boolean;
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  readonly layout: DockLayout;
}

export const DEFAULT_LAYOUT: DockLayout = {
  mediaWidth: DEFAULT_MEDIA_W,
  inspectorWidth: DEFAULT_INSPECTOR_W,
  chatWidth: DEFAULT_CHAT_W,
  timelineVh: DEFAULT_TIMELINE_VH,
  section: "media",
  mixerOpen: false,
  chatOpen: false,
};

export const BUILT_IN_WORKSPACES: readonly Workspace[] = [
  { id: "editing", name: "Editing", builtIn: true, layout: DEFAULT_LAYOUT },
  {
    id: "color",
    name: "Color",
    builtIn: true,
    // Wide inspector for the grading controls, effects browser on the left, shorter timeline.
    layout: { ...DEFAULT_LAYOUT, mediaWidth: 260, inspectorWidth: 480, timelineVh: 28, section: "effects" },
  },
  {
    id: "audio",
    name: "Audio",
    builtIn: true,
    // Tall timeline for waveforms and meters, audio browser on the left.
    layout: { ...DEFAULT_LAYOUT, timelineVh: 46, section: "audio" },
  },
];

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max));
const finite = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const SECTIONS: ReadonlySet<string> = new Set(["media", "audio", "text", "effects", "transitions", "graphics", "ai", "recipes", "markers", "comments", "versions", "templates", "settings"]);

/** Clamp a stored or imported layout into the ranges the dock supports. */
export function sanitizeLayout(input: Partial<Record<keyof DockLayout, unknown>> | null | undefined): DockLayout {
  const raw = input ?? {};
  return {
    mediaWidth: clamp(finite(raw.mediaWidth, DEFAULT_MEDIA_W), MIN_MEDIA_W, MAX_MEDIA_W),
    inspectorWidth: clamp(finite(raw.inspectorWidth, DEFAULT_INSPECTOR_W), MIN_INSPECTOR_W, MAX_INSPECTOR_W),
    chatWidth: clamp(finite(raw.chatWidth, DEFAULT_CHAT_W), MIN_CHAT_W, MAX_CHAT_W),
    timelineVh: clamp(finite(raw.timelineVh, DEFAULT_TIMELINE_VH), MIN_TIMELINE_VH, MAX_TIMELINE_VH),
    section: typeof raw.section === "string" && SECTIONS.has(raw.section) ? (raw.section as AssetSection) : "media",
    mixerOpen: raw.mixerOpen === true,
    chatOpen: raw.chatOpen === true,
  };
}

export function layoutsEqual(a: DockLayout, b: DockLayout): boolean {
  return (
    Math.round(a.mediaWidth) === Math.round(b.mediaWidth) &&
    Math.round(a.inspectorWidth) === Math.round(b.inspectorWidth) &&
    Math.round(a.chatWidth) === Math.round(b.chatWidth) &&
    Math.abs(a.timelineVh - b.timelineVh) < 0.5 &&
    a.section === b.section &&
    a.mixerOpen === b.mixerOpen &&
    a.chatOpen === b.chatOpen
  );
}

export const MAX_WORKSPACE_NAME = 40;

export function normalizeWorkspaceName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_WORKSPACE_NAME);
}

export function sanitizeWorkspaces(input: unknown): Workspace[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>(BUILT_IN_WORKSPACES.map((w) => w.id));
  const out: Workspace[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name, layout } = entry as { id?: unknown; name?: unknown; layout?: unknown };
    if (typeof id !== "string" || !id || seen.has(id) || typeof name !== "string") continue;
    const clean = normalizeWorkspaceName(name);
    if (!clean) continue;
    seen.add(id);
    out.push({ id, name: clean, builtIn: false, layout: sanitizeLayout(layout as Partial<Record<keyof DockLayout, unknown>>) });
  }
  return out;
}

export interface WorkspaceLayoutState {
  /** The live dock geometry (what the editor renders). */
  layout: DockLayout;
  /** Workspaces the user saved; the built-ins are not stored. */
  userWorkspaces: Workspace[];
  activeId: string;
  /** Dialog flag for "Save layout as workspace". Not persisted. */
  saveDialogOpen: boolean;
  setSaveDialogOpen: (open: boolean) => void;
  patchLayout: (patch: Partial<Pick<DockLayout, "mediaWidth" | "inspectorWidth" | "chatWidth" | "timelineVh">>) => void;
  all: () => Workspace[];
  /** Apply a workspace to the editor: dock geometry, asset section, mixer and chat visibility. */
  applyWorkspace: (id: string) => boolean;
  /** Snapshot the editor as a new user workspace (or overwrite the one with the same name). */
  saveWorkspace: (name: string) => Workspace | null;
  /** Overwrite a saved workspace with the editor's current layout. */
  updateWorkspace: (id: string) => boolean;
  renameWorkspace: (id: string, name: string) => boolean;
  deleteWorkspace: (id: string) => boolean;
  /** Put the active workspace back to how it was saved (built-ins: factory layout). */
  resetActiveWorkspace: () => void;
}

/** What the editor looks like right now, as a layout. */
export function captureLayout(): DockLayout {
  const live = useWorkspaceLayoutStore.getState().layout;
  const ui = useUIStore.getState();
  return {
    ...live,
    section: useEditorWorkspaceStore.getState().section,
    mixerOpen: ui.panels.audioMixer?.visible ?? false,
    chatOpen: ui.panels.agentChat?.visible ?? false,
  };
}

function pushLayoutToEditor(layout: DockLayout): void {
  useEditorWorkspaceStore.getState().setSection(layout.section);
  const ui = useUIStore.getState();
  ui.setPanelVisible("audioMixer", layout.mixerOpen);
  ui.setPanelVisible("agentChat", layout.chatOpen);
  // A workspace is a whole layout: a maximised timeline would hide the geometry it applies.
  if (ui.timelineMaximized) ui.toggleTimelineMaximized();
}

const newId = (): string => `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>()(
  persist(
    (set, get) => ({
      layout: DEFAULT_LAYOUT,
      userWorkspaces: [],
      activeId: "editing",
      saveDialogOpen: false,
      setSaveDialogOpen: (open) => set({ saveDialogOpen: open }),
      patchLayout: (patch) => set((state) => ({ layout: sanitizeLayout({ ...state.layout, ...patch }) })),
      all: () => [...BUILT_IN_WORKSPACES, ...get().userWorkspaces],
      applyWorkspace: (id) => {
        const target = get().all().find((w) => w.id === id);
        if (!target) return false;
        set({ layout: sanitizeLayout(target.layout), activeId: target.id });
        pushLayoutToEditor(target.layout);
        return true;
      },
      saveWorkspace: (rawName) => {
        const name = normalizeWorkspaceName(rawName);
        if (!name) return null;
        if (BUILT_IN_WORKSPACES.some((w) => w.name.toLowerCase() === name.toLowerCase())) return null;
        const layout = captureLayout();
        const existing = get().userWorkspaces.find((w) => w.name.toLowerCase() === name.toLowerCase());
        const saved: Workspace = { id: existing?.id ?? newId(), name, builtIn: false, layout };
        set((state) => ({
          userWorkspaces: existing ? state.userWorkspaces.map((w) => (w.id === existing.id ? saved : w)) : [...state.userWorkspaces, saved],
          activeId: saved.id,
        }));
        return saved;
      },
      updateWorkspace: (id) => {
        const target = get().userWorkspaces.find((w) => w.id === id);
        if (!target) return false;
        const layout = captureLayout();
        set((state) => ({ userWorkspaces: state.userWorkspaces.map((w) => (w.id === id ? { ...w, layout } : w)), activeId: id }));
        return true;
      },
      renameWorkspace: (id, rawName) => {
        const name = normalizeWorkspaceName(rawName);
        const clash = get().all().some((w) => w.id !== id && w.name.toLowerCase() === name.toLowerCase());
        if (!name || clash || !get().userWorkspaces.some((w) => w.id === id)) return false;
        set((state) => ({ userWorkspaces: state.userWorkspaces.map((w) => (w.id === id ? { ...w, name } : w)) }));
        return true;
      },
      deleteWorkspace: (id) => {
        if (!get().userWorkspaces.some((w) => w.id === id)) return false;
        set((state) => ({ userWorkspaces: state.userWorkspaces.filter((w) => w.id !== id), activeId: state.activeId === id ? "editing" : state.activeId }));
        return true;
      },
      resetActiveWorkspace: () => {
        get().applyWorkspace(get().activeId);
      },
    }),
    {
      name: "openreel-workspaces",
      version: 1,
      partialize: (state) => ({ layout: state.layout, userWorkspaces: state.userWorkspaces, activeId: state.activeId }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<Pick<WorkspaceLayoutState, "layout" | "userWorkspaces" | "activeId">>;
        const userWorkspaces = sanitizeWorkspaces(stored.userWorkspaces);
        const known = new Set([...BUILT_IN_WORKSPACES, ...userWorkspaces].map((w) => w.id));
        return {
          ...current,
          layout: sanitizeLayout(stored.layout as Partial<Record<keyof DockLayout, unknown>>),
          userWorkspaces,
          activeId: typeof stored.activeId === "string" && known.has(stored.activeId) ? stored.activeId : "editing",
        };
      },
    },
  ),
);

type DockSizeKey = "mediaWidth" | "inspectorWidth" | "chatWidth" | "timelineVh";

/** `[value, setter]` for one dock dimension, with the same call shapes as `useState`. */
export function useDockSize(key: DockSizeKey): [number, (next: number | ((current: number) => number)) => void] {
  const value = useWorkspaceLayoutStore((state) => state.layout[key]);
  const set = useCallback(
    (next: number | ((current: number) => number)) => {
      const store = useWorkspaceLayoutStore.getState();
      store.patchLayout({ [key]: typeof next === "function" ? next(store.layout[key]) : next });
    },
    [key],
  );
  return [value, set];
}
