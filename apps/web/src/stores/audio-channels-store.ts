import { create } from "zustand";

/**
 * Modify > Audio Channels dialogs. `clipIds` edits timeline clips (clip channel maps); `sourceMediaIds` edits project
 * items (how a file's channels group into audio clips, the multichannel source layout). Empty + closed = not shown.
 */
interface AudioChannelsDialogState {
  open: boolean;
  clipIds: readonly string[];
  openFor: (clipIds: readonly string[]) => void;
  close: () => void;
  sourceOpen: boolean;
  sourceMediaIds: readonly string[];
  openSourceFor: (mediaIds: readonly string[]) => void;
  closeSource: () => void;
}

export const useAudioChannelsStore = create<AudioChannelsDialogState>((set) => ({
  open: false,
  clipIds: [],
  openFor: (clipIds) => set({ open: clipIds.length > 0, clipIds: [...clipIds] }),
  close: () => set({ open: false }),
  sourceOpen: false,
  sourceMediaIds: [],
  openSourceFor: (mediaIds) => set({ sourceOpen: mediaIds.length > 0, sourceMediaIds: [...mediaIds] }),
  closeSource: () => set({ sourceOpen: false }),
}));
