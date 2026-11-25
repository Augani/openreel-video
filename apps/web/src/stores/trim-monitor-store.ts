import { create } from "zustand";
import type { TrimMonitorMode, TrimMonitorSide } from "@openreel/core";

/**
 * Trim Monitor state. Editor state only, never saved in the project: whether the dual-view monitor is
 * open, which trim mode it applies, and the loop-around-the-edit playback. The edit point itself is the
 * edit-point store's selection, so the timeline highlights what the monitor trims.
 */
interface TrimMonitorState {
  open: boolean;
  mode: TrimMonitorMode;
  /** Which clip Slip and Slide act on. */
  side: TrimMonitorSide;
  /** Playhead before the monitor opened (a closed monitor leaves the playhead on the edit). */
  savedPlayhead: number;
  /** Looping playback around the edit is running. */
  playingAround: boolean;
  /** Seconds played before / after the edit by Play Around Edit. */
  preroll: number;
  postroll: number;
  /** The last trim applied from the monitor, in frames (display only). */
  lastOffset: number | null;
  /** A reason the last trim did nothing (source handle, locked track, sync lock). */
  notice: string | null;
  setOpen: (open: boolean, savedPlayhead?: number) => void;
  setMode: (mode: TrimMonitorMode) => void;
  setSide: (side: TrimMonitorSide) => void;
  setPlayingAround: (playingAround: boolean) => void;
  setRolls: (preroll: number, postroll: number) => void;
  setLastOffset: (lastOffset: number | null, notice?: string | null) => void;
}

export const useTrimMonitorStore = create<TrimMonitorState>((set) => ({
  open: false,
  mode: "roll",
  side: "incoming",
  savedPlayhead: 0,
  playingAround: false,
  preroll: 2,
  postroll: 2,
  lastOffset: null,
  notice: null,
  setOpen: (open, savedPlayhead) =>
    set((state) => ({
      open,
      savedPlayhead: savedPlayhead ?? state.savedPlayhead,
      playingAround: open ? state.playingAround : false,
      lastOffset: null,
      notice: null,
    })),
  setMode: (mode) => set({ mode, lastOffset: null, notice: null }),
  setSide: (side) => set({ side, lastOffset: null, notice: null }),
  setPlayingAround: (playingAround) => set({ playingAround }),
  setRolls: (preroll, postroll) => set({ preroll, postroll }),
  setLastOffset: (lastOffset, notice = null) => set({ lastOffset, notice }),
}));
