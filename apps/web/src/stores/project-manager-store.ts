import { create } from "zustand";
import type { OpenReelProjectManagerEvent } from "../types/global";

/** Dialog and job state of File > Project Manager. Tiny on purpose: the dialog and its service load on first use. */
interface ProjectManagerState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Latest event of the running or last finished job. */
  job: OpenReelProjectManagerEvent | null;
  setJob: (job: OpenReelProjectManagerEvent | null) => void;
}

export const useProjectManagerStore = create<ProjectManagerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  job: null,
  setJob: (job) => set({ job }),
}));
