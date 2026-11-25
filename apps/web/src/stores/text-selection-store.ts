import { create } from "zustand";

/**
 * The character range selected in a title, shared between the Program monitor's
 * in-place editor and the Text inspector so a run style applies to what the
 * user selected in either. Offsets index into `TextClip.text`. UI state only:
 * the edit itself goes through the project store (one undo step).
 */
interface TextSelectionState {
  clipId: string | null;
  start: number;
  end: number;
  setSelection: (clipId: string, start: number, end: number) => void;
  clear: () => void;
}

export const useTextSelectionStore = create<TextSelectionState>((set) => ({
  clipId: null,
  start: 0,
  end: 0,
  setSelection: (clipId, start, end) => set({ clipId, start: Math.min(start, end), end: Math.max(start, end) }),
  clear: () => set({ clipId: null, start: 0, end: 0 }),
}));

/** Selection of `clipId` clamped to `length`, or null when another clip (or nothing) is selected. */
export function selectionForClip(
  state: Pick<TextSelectionState, "clipId" | "start" | "end">,
  clipId: string,
  length: number,
): { start: number; end: number } | null {
  if (state.clipId !== clipId) return null;
  return { start: Math.min(state.start, length), end: Math.min(state.end, length) };
}
