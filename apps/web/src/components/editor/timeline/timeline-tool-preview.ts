import { create } from "zustand";
export interface ToolGhostNeighbor {
  trackId: string;
  startTime: number;
  duration: number;
  /** Live readout (new length and position) shown on the adjusted clip. */
  label?: string;
}
interface ToolGhost {
  trackId: string;
  startTime: number;
  duration: number;
  label: string;
  /** The adjoining clip a roll moves along with the primary one. */
  neighbor?: ToolGhostNeighbor;
  /** Every adjoining clip the edit changes (slide adjusts two). */
  neighbors?: ToolGhostNeighbor[];
}
export const useTimelineToolPreview = create<{
  ghost: ToolGhost | null;
  setGhost: (ghost: ToolGhost | null) => void;
}>((set) => ({ ghost: null, setGhost: (ghost) => set({ ghost }) }));
