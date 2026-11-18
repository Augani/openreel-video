import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { OpenReelOnboardingMirror } from "../types/global";

/**
 * First-run onboarding state (spec 4.1 and 4.2). Own store and persist key so it never touches the
 * ui-store persist version. All storage access is wrapped in try/catch; it must never throw.
 */

export const ONBOARDING_STORAGE_KEY = "openreel-onboarding";
/** Legacy "passive tour finished" flag; also what the web e2e suite seeds (tour-steps.ts ONBOARDING_KEY). */
export const LEGACY_ONBOARDING_KEY = "openreel-onboarding-complete";
export const UI_PREFERENCES_KEY = "openreel-ui-preferences";

export type OnboardingStatus = "unseen" | "in-progress" | "done" | "skipped";
export type OnboardingSkippedBy = "user" | "agent" | "automation" | "format";
export type OnboardingPersona = "pro" | "ai" | "learn" | "agent";
export type OnboardingPath = "ai" | "learn";
export type OnboardingLessonState = "todo" | "done" | "skipped";
export type OnboardingSheet = "ai" | "learn" | "agent" | "lessons" | "custom-sequence";

export interface OnboardingState {
  v: 1;
  status: OnboardingStatus;
  skippedBy?: OnboardingSkippedBy;
  persona?: OnboardingPersona;
  path?: OnboardingPath;
  /** Resume point inside a path (free-form id owned by that path). */
  step?: string;
  keymap?: string;
  workspace?: string;
  lessons: Record<string, OnboardingLessonState>;
  currentLesson?: string;
  completedAt?: number;
  /** Transient (never persisted). */
  openSheet?: OnboardingSheet | null;
  /** Transient (never persisted): the project whose format was already chosen, so EmptyProjectStart stays hidden. */
  formatChosenProjectId?: string;
  /** Transient (never persisted): "Welcome & Setup" re-opened the band after it was dismissed. */
  bandOpen?: boolean;
}

export interface OnboardingActions {
  /** Enter a path. Status becomes "in-progress" (only from unseen/skipped), persona is recorded. */
  start: (persona: OnboardingPersona, path?: OnboardingPath) => void;
  setPersona: (persona: OnboardingPersona) => void;
  setStep: (step: string | undefined) => void;
  setKeymap: (keymap: string) => void;
  setWorkspace: (workspace: string) => void;
  setLesson: (id: string, state: OnboardingLessonState) => void;
  setCurrentLesson: (id: string | undefined) => void;
  /** Finished a path. Closes any sheet. */
  markDone: () => void;
  /**
   * Dismiss onboarding. Closes any sheet and keeps lesson/AI progress. No-op on status when already
   * done or skipped (a later skip never downgrades "done").
   */
  skip: (by: OnboardingSkippedBy) => void;
  /** "Reset onboarding" (Help menu): back to unseen, forgetting progress. Persisted explicitly. */
  reset: () => void;
  showSheet: (sheet: OnboardingSheet) => void;
  /** Help > "Welcome & Setup...": show the path band again on the welcome screen without changing status. */
  reopenBand: () => void;
  closeSheet: () => void;
  /** A format card, wizard or custom sequence created `projectId`; hides the duplicate format picker. */
  markFormatChosen: (projectId: string) => void;
  /** Fold in the main-process mirror (userData/onboarding.json). A done mirror collapses an unseen band. */
  applyMirror: (mirror: OpenReelOnboardingMirror | null | undefined) => void;
}

export type OnboardingStore = OnboardingState & OnboardingActions;

const STATUSES: readonly OnboardingStatus[] = ["unseen", "in-progress", "done", "skipped"];
const SKIPPED_BY: readonly OnboardingSkippedBy[] = ["user", "agent", "automation", "format"];
const PERSONAS: readonly OnboardingPersona[] = ["pro", "ai", "learn", "agent"];
const PATHS: readonly OnboardingPath[] = ["ai", "learn"];
const LESSON_STATES: readonly OnboardingLessonState[] = ["todo", "done", "skipped"];

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Defensive parse of whatever was in storage. Unknown or corrupt fields are dropped. */
function sanitizePersisted(raw: unknown): Partial<OnboardingState> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const status = pick(r.status, STATUSES);
  if (!status) return null;
  const lessons: Record<string, OnboardingLessonState> = {};
  if (r.lessons && typeof r.lessons === "object") {
    for (const [id, value] of Object.entries(r.lessons as Record<string, unknown>)) {
      const state = pick(value, LESSON_STATES);
      if (state) lessons[id] = state;
    }
  }
  const out: Partial<OnboardingState> = { v: 1, status, lessons };
  const skippedBy = pick(r.skippedBy, SKIPPED_BY);
  // "automation" is in-memory only and must never be restored from disk.
  if (skippedBy && skippedBy !== "automation") out.skippedBy = skippedBy;
  const persona = pick(r.persona, PERSONAS);
  if (persona) out.persona = persona;
  const path = pick(r.path, PATHS);
  if (path) out.path = path;
  const step = str(r.step);
  if (step) out.step = step;
  const keymap = str(r.keymap);
  if (keymap) out.keymap = keymap;
  const workspace = str(r.workspace);
  if (workspace) out.workspace = workspace;
  const currentLesson = str(r.currentLesson);
  if (currentLesson) out.currentLesson = currentLesson;
  if (typeof r.completedAt === "number" && Number.isFinite(r.completedAt)) {
    out.completedAt = r.completedAt;
  }
  return out;
}

function safeGetItem(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Existing users: they dismissed the welcome screen or finished the passive tour before this feature. */
export function hasLegacyOnboardingFlag(): boolean {
  if (safeGetItem(LEGACY_ONBOARDING_KEY) !== null) return true;
  const prefs = safeGetItem(UI_PREFERENCES_KEY);
  if (!prefs) return false;
  try {
    const parsed = JSON.parse(prefs) as { state?: { skipWelcomeScreen?: unknown } } | null;
    return parsed?.state?.skipWelcomeScreen === true;
  } catch {
    return false;
  }
}

function isAutomationLaunch(): boolean {
  try {
    return typeof window !== "undefined" && window.openreel?.automation === true;
  } catch {
    return false;
  }
}

/** localStorage that never throws; with no storage it degrades to a no-op (state stays in memory). */
const safeStorage: StateStorage = {
  getItem: (name) => safeGetItem(name),
  setItem: (name, value) => {
    // Automation runs hold an in-memory "skipped" that must not overwrite what a real user will see later.
    try {
      const parsed = JSON.parse(value) as { state?: { skippedBy?: unknown } };
      if (parsed?.state?.skippedBy === "automation") return;
    } catch {
      // fall through and write
    }
    try {
      localStorage.setItem(name, value);
    } catch {
      // storage blocked or full: keep going in memory
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};

const initialState = (): OnboardingState => ({
  v: 1,
  status: "unseen",
  lessons: {},
  openSheet: null,
  bandOpen: false,
});

/** Settled once at store creation so the first paint already knows whether to show the band. */
let derivedDoneFromLegacy = false;

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set, get) => ({
      ...initialState(),

      start: (persona, path) =>
        set((s) => ({
          persona,
          path: path ?? s.path,
          status: s.status === "unseen" || s.status === "skipped" ? "in-progress" : s.status,
          skippedBy: s.status === "skipped" ? undefined : s.skippedBy,
        })),
      setPersona: (persona) => set({ persona }),
      setStep: (step) => set({ step }),
      setKeymap: (keymap) => set({ keymap }),
      setWorkspace: (workspace) => set({ workspace }),
      setLesson: (id, state) => set((s) => ({ lessons: { ...s.lessons, [id]: state } })),
      setCurrentLesson: (currentLesson) => set({ currentLesson }),
      markDone: () =>
        set({
          status: "done",
          skippedBy: undefined,
          completedAt: Date.now(),
          openSheet: null,
          bandOpen: false,
        }),
      skip: (by) => {
        const status = get().status;
        if (status === "done" || status === "skipped") {
          set({ openSheet: null, bandOpen: false });
          return;
        }
        set({ status: "skipped", skippedBy: by, openSheet: null, bandOpen: false });
      },
      reset: () => set({ ...initialState(), formatChosenProjectId: undefined }),
      showSheet: (sheet) => set({ openSheet: sheet }),
      reopenBand: () => set({ bandOpen: true }),
      closeSheet: () => set({ openSheet: null }),
      markFormatChosen: (projectId) => set({ formatChosenProjectId: projectId }),
      applyMirror: (mirror) => {
        if (!mirror || mirror.status === "unseen" || mirror.status === "in-progress") return;
        const s = get();
        if (s.status !== "unseen") return;
        set({
          status: "done",
          persona: s.persona ?? mirror.persona,
          path: s.path ?? mirror.path,
          completedAt: s.completedAt ?? mirror.completedAt,
        });
      },
    }),
    {
      name: ONBOARDING_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      // Everything except the transient fields and the actions.
      partialize: (s): Partial<OnboardingState> => ({
        v: s.v,
        status: s.status,
        skippedBy: s.skippedBy,
        persona: s.persona,
        path: s.path,
        step: s.step,
        keymap: s.keymap,
        workspace: s.workspace,
        lessons: s.lessons,
        currentLesson: s.currentLesson,
        completedAt: s.completedAt,
      }),
      migrate: (persisted) => sanitizePersisted(persisted) ?? initialState(),
      merge: (persisted, current) => {
        const stored = sanitizePersisted(persisted);
        const merged: OnboardingStore = { ...current, ...(stored ?? {}) };
        if (!stored) {
          // No record yet. Existing users (legacy flags) must never be re-onboarded.
          if (hasLegacyOnboardingFlag()) {
            merged.status = "done";
            derivedDoneFromLegacy = true;
          }
        }
        if (isAutomationLaunch() && (merged.status === "unseen" || merged.status === "in-progress")) {
          // In memory only: safeStorage refuses to write skippedBy "automation".
          merged.status = "skipped";
          merged.skippedBy = "automation";
        }
        merged.openSheet = null;
        merged.bandOpen = false;
        merged.formatChosenProjectId = undefined;
        return merged;
      },
    },
  ),
);

// Persist the migration result once, so a later change to the legacy flags cannot flip it back.
if (derivedDoneFromLegacy) {
  useOnboardingStore.setState({ status: "done" });
}

/** The snapshot sent to the main-process mirror (`window.openreel.onboarding.set`). */
export function toOnboardingMirror(s: OnboardingState): OpenReelOnboardingMirror {
  return {
    v: 1,
    status: s.status,
    skippedBy: s.skippedBy,
    persona: s.persona,
    path: s.path,
    completedAt: s.completedAt,
  };
}
