import { create } from "zustand";
import type { EditPointEdge, EditPointKind, Project } from "@openreel/core";

/**
 * Trim-mode selection: one edit point (a clip edge or the cut between two
 * clips) or one gap. Editor state only, never saved in the project. The UI
 * store's select/selectMultiple clear it when clips are selected, and
 * selecting it clears the clip selection, so Delete and the trim keys always
 * have one unambiguous target.
 */
export type EditSelection =
  | {
      type: "edit";
      clipId: string;
      edge: EditPointEdge;
      kind: EditPointKind;
      /** The clip across the cut, highlighted with this one; null at a free edge. */
      neighborId: string | null;
    }
  | { type: "gap"; trackId: string; start: number; end: number };

/** A live JKL trim in progress. The project is untouched until it commits. */
export interface DynamicTrimSession {
  /** The edit point the session started on; a changed selection cancels it. */
  clipId: string;
  edge: EditPointEdge;
  kind: EditPointKind;
  /** Project timeline object when the trim began; any other edit or undo replaces it. */
  timelineRef: object;
  /** Edge time when the trim began; frames are measured from here. */
  anchorTime: number;
  /** Playhead before the trim, restored on cancel. */
  savedPlayhead: number;
  /** Snap setting before the trim (snapping is off while it runs). */
  savedSnap: boolean;
  /** -1 reverse, 0 stopped (limit reached), 1 forward. */
  direction: -1 | 0 | 1;
  /** Shuttle multiplier: 1, 2, 4, 8. */
  speed: number;
  /** Whole frames the playhead asks for, from the anchor. */
  requestedFrames: number;
  /** Frames the planner will actually apply (clamped to handles). */
  appliedFrames: number;
  /** True when the request is clamped by source handles or neighbours. */
  limited: boolean;
  /**
   * The project as it would be with the trim committed, for the Program monitor only.
   * Never written to the project store or history; null while nothing moves (or if it
   * could not be built).
   */
  previewProject: Project | null;
}

interface EditPointState {
  selection: EditSelection | null;
  /** Premiere's "Dynamic trimming" toggle: J/K/L trim the selected edit point. */
  dynamicTrimEnabled: boolean;
  dynamicTrim: DynamicTrimSession | null;
  setDynamicTrimEnabled: (enabled: boolean) => void;
  setDynamicTrim: (session: DynamicTrimSession | null) => void;
  set: (selection: EditSelection | null) => void;
  clear: () => void;
}

export const useEditPointStore = create<EditPointState>((set) => ({
  selection: null,
  dynamicTrimEnabled: true,
  dynamicTrim: null,
  setDynamicTrimEnabled: (dynamicTrimEnabled) => set({ dynamicTrimEnabled }),
  setDynamicTrim: (dynamicTrim) => set({ dynamicTrim }),
  set: (selection) => set({ selection }),
  clear: () => set({ selection: null }),
}));
