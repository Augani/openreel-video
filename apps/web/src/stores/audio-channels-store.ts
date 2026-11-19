import { create } from "zustand";

/** Which clips the Modify > Audio Channels dialog is editing (empty + closed = not shown). */
interface AudioChannelsDialogState {
  open: boolean;
  clipIds: readonly string[];
  openFor: (clipIds: readonly string[]) => void;
  close: () => void;
}

export const useAudioChannelsStore = create<AudioChannelsDialogState>((set) => ({
  open: false,
  clipIds: [],
  openFor: (clipIds) => set({ open: clipIds.length > 0, clipIds: [...clipIds] }),
  close: () => set({ open: false }),
}));
