import { create } from "zustand";
import type { MaskPoint } from "@openreel/core";
import type { ObjectMaskPrompt } from "../services/object-mask";

const DEFAULT_TOLERANCE = 2;

export type ObjectMaskMode = "click" | "brush";

/** UI state of the Program monitor object mask tool and of a running track. Nothing here is project data. */
interface ObjectMaskState {
  active: boolean;
  clipId: string | null;
  mode: ObjectMaskMode;
  /** The mask the current clicks are refining (null until the first click made one). */
  maskId: string | null;
  prompt: ObjectMaskPrompt;
  busy: boolean;
  error: string | null;
  tracking: { maskId: string; direction: "forward" | "backward"; progress: number; lostFrames: number } | null;
  /** Tracked keyframes are simplified so no outline point moves more than this many composition pixels (0 keeps every frame). */
  simplifyTolerance: number;
  /** A running Remove Object analysis. */
  removing: { maskId: string; progress: number } | null;
  arm: (clipId: string) => void;
  disarm: () => void;
  setMode: (mode: ObjectMaskMode) => void;
  addPoint: (kind: "include" | "exclude", point: MaskPoint) => void;
  addStroke: (points: MaskPoint[], include: boolean) => void;
  setMask: (maskId: string | null) => void;
  setBusy: (busy: boolean, error?: string | null) => void;
  setTracking: (tracking: ObjectMaskState["tracking"]) => void;
  setSimplifyTolerance: (tolerance: number) => void;
  setRemoving: (removing: ObjectMaskState["removing"]) => void;
}

const EMPTY: ObjectMaskPrompt = { include: [], exclude: [], strokes: [] };

export const useObjectMaskStore = create<ObjectMaskState>((set) => ({
  active: false,
  clipId: null,
  mode: "click",
  maskId: null,
  prompt: EMPTY,
  busy: false,
  error: null,
  tracking: null,
  simplifyTolerance: DEFAULT_TOLERANCE,
  removing: null,
  arm: (clipId) => set({ active: true, clipId, maskId: null, prompt: EMPTY, error: null }),
  disarm: () => set({ active: false, clipId: null, maskId: null, prompt: EMPTY, busy: false, error: null }),
  setMode: (mode) => set({ mode }),
  addPoint: (kind, point) => set((s) => ({ prompt: { ...s.prompt, [kind]: [...s.prompt[kind], point] } })),
  addStroke: (points, include) => set((s) => ({ prompt: { ...s.prompt, strokes: [...s.prompt.strokes, { points, include }] } })),
  setMask: (maskId) => set({ maskId }),
  setBusy: (busy, error = null) => set({ busy, error }),
  setTracking: (tracking) => set({ tracking }),
  setSimplifyTolerance: (simplifyTolerance) => set({ simplifyTolerance: Math.max(0, Math.min(10, simplifyTolerance)) }),
  setRemoving: (removing) => set({ removing }),
}));
