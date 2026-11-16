import { create } from "zustand";

/** Open state of the Manage Plugins dialog (Effects > Manage Plugins). Kept tiny: it is on the startup path. */
interface PluginManagerState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const usePluginManagerStore = create<PluginManagerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
