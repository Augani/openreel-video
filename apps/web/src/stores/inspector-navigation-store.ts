import { create } from "zustand";

export interface InspectorSectionRequest {
  sectionId: string;
  clipId: string;
  sequence: number;
}

interface InspectorNavigationState {
  request: InspectorSectionRequest | null;
  requestSection: (sectionId: string, clipId: string) => void;
  clearRequest: () => void;
}

// Navigation is transient. It must not reopen a tool on a different project.
export const useInspectorNavigationStore = create<InspectorNavigationState>((set) => ({
  request: null,
  requestSection: (sectionId, clipId) => set((state) => ({
    request: { sectionId, clipId, sequence: (state.request?.sequence ?? 0) + 1 },
  })),
  clearRequest: () => set({ request: null }),
}));
