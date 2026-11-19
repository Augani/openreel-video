import { create } from "zustand";

/** Open state of the Clip > Speed/Duration dialog. */
interface ClipSpeedDialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useClipSpeedDialogStore = create<ClipSpeedDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
