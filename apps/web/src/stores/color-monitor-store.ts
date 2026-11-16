import { create } from "zustand";
import type { EyedropperMode } from "@openreel/core";

export type ComparisonMode = "off" | "side" | "split-v" | "split-h";
export type ComparisonReference = "still" | "bypass" | "playhead";
/** 0 off, 1 colour overlay, 2 gray matte, 3 black / white matte. */
export type MatteView = 0 | 1 | 2 | 3;

export interface StillEntry {
  id: string;
  label: string;
  /** Timeline time the still was grabbed at. */
  time: number;
  width: number;
  height: number;
  /** Small data URL for the Color tab. */
  thumb: string;
}

export interface ComparisonState {
  mode: ComparisonMode;
  reference: ComparisonReference;
  /** Wipe position 0..1 (share of the frame given to the reference side). */
  split: number;
  stillId: string | null;
  /** Timeline time of the "playhead position" reference. */
  refTime: number | null;
}

export interface SecondaryViewState {
  clipId: string | null;
  effectId: string | null;
  matteView: MatteView;
  eyedropper: EyedropperMode | null;
}

interface ColorMonitorStore {
  comparison: ComparisonState;
  stills: StillEntry[];
  secondary: SecondaryViewState;
  /** False-colour exposure overlay on the Program monitor (preview only). */
  falseColor: boolean;
  setFalseColor: (on: boolean) => void;
  /** True while a reference frame is being rendered; the overlay holds still. */
  captureBusy: boolean;
  /** Bumped whenever the reference image changes so the overlay can redraw. */
  referenceRevision: number;
  setComparison: (patch: Partial<ComparisonState>) => void;
  toggleComparison: () => void;
  addStill: (still: StillEntry) => void;
  removeStill: (id: string) => void;
  setSecondaryView: (patch: Partial<SecondaryViewState>) => void;
  setCaptureBusy: (busy: boolean) => void;
  bumpReference: () => void;
}

const COMPARISON_DEFAULT: ComparisonState = {
  mode: "off",
  reference: "bypass",
  split: 0.5,
  stillId: null,
  refTime: null,
};

const SECONDARY_DEFAULT: SecondaryViewState = {
  clipId: null,
  effectId: null,
  matteView: 0,
  eyedropper: null,
};

export const useColorMonitorStore = create<ColorMonitorStore>((set) => ({
  comparison: COMPARISON_DEFAULT,
  stills: [],
  secondary: SECONDARY_DEFAULT,
  captureBusy: false,
  falseColor: false,
  setFalseColor: (on) => set({ falseColor: on }),
  referenceRevision: 0,
  setComparison: (patch) =>
    set((state) => ({
      comparison: {
        ...state.comparison,
        ...patch,
        split: Math.min(0.98, Math.max(0.02, patch.split ?? state.comparison.split)),
      },
    })),
  toggleComparison: () =>
    set((state) => ({
      comparison: {
        ...state.comparison,
        mode: state.comparison.mode === "off" ? "split-v" : "off",
      },
    })),
  addStill: (still) =>
    set((state) => ({
      stills: [...state.stills, still].slice(-12),
      comparison: { ...state.comparison, stillId: still.id, reference: "still" },
    })),
  removeStill: (id) =>
    set((state) => ({
      stills: state.stills.filter((still) => still.id !== id),
      comparison:
        state.comparison.stillId === id
          ? { ...state.comparison, stillId: null }
          : state.comparison,
    })),
  setSecondaryView: (patch) =>
    set((state) => ({ secondary: { ...state.secondary, ...patch } })),
  setCaptureBusy: (busy) => set({ captureBusy: busy }),
  bumpReference: () => set((state) => ({ referenceRevision: state.referenceRevision + 1 })),
}));
