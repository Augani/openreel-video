import { create } from "zustand";

/**
 * Coach marks shown once after the AI path hands the user into the editor (spec 2.4):
 *   watch  "Watch each step appear" while the first turn runs
 *   undo   "Don't like it? Undo AI edit puts everything back" once the turn finished
 *   export "Happy? Open Export" (the AI can only open the dialog)
 * Each mark is remembered as seen so it never repeats. Storage access never throws.
 */
export type CoachStep = "watch" | "undo" | "export";
export const COACH_STEPS: readonly CoachStep[] = ["watch", "undo", "export"];
export const COACH_STORAGE_KEY = "openreel-ai-coach-seen";

function readSeen(): CoachStep[] {
  try {
    const raw = localStorage.getItem(COACH_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? COACH_STEPS.filter((step) => (parsed as unknown[]).includes(step))
      : [];
  } catch {
    return [];
  }
}

function writeSeen(seen: readonly CoachStep[]): void {
  try {
    localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // blocked storage: marks may show again next session, which is harmless
  }
}

interface CoachState {
  /** The mark being shown, or null. */
  active: CoachStep | null;
  /** True once the user came through the AI path this session (marks only run for them). */
  armed: boolean;
  seen: CoachStep[];
  /** The AI path handed off: start with the first mark that was not seen yet. */
  arm: () => void;
  /** Show `step` if the path is armed and it was not seen. */
  show: (step: CoachStep) => void;
  /** Mark the active step seen and move to `next` (when it is unseen). */
  dismiss: (next?: CoachStep) => void;
  /** Stop all marks for this session. */
  finish: () => void;
  reset: () => void;
}

export const useCoachStore = create<CoachState>((set, get) => ({
  active: null,
  armed: false,
  seen: readSeen(),
  arm: () => {
    set({ armed: true, seen: readSeen() });
    get().show("watch");
  },
  show: (step) => {
    const s = get();
    if (!s.armed || s.seen.includes(step)) return;
    set({ active: step });
  },
  dismiss: (next) => {
    const s = get();
    if (!s.active) return;
    const seen = s.seen.includes(s.active) ? s.seen : [...s.seen, s.active];
    writeSeen(seen);
    set({ seen, active: null });
    if (next) get().show(next);
  },
  finish: () => {
    const s = get();
    const seen = COACH_STEPS.filter((step) => s.seen.includes(step) || step === s.active);
    writeSeen(seen);
    set({ active: null, armed: false, seen });
  },
  reset: () => set({ active: null, armed: false, seen: [] }),
}));
