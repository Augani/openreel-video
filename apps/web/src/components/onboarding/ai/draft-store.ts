import { create } from "zustand";

/**
 * A prompt the user wrote in the AI sheet before a model was connected. The chat composer picks it
 * up (and clears it) so the one description a beginner wrote is never lost.
 */
interface OnboardingDraftState {
  text: string;
  set: (text: string) => void;
  clear: () => void;
}

export const useOnboardingDraft = create<OnboardingDraftState>((set) => ({
  text: "",
  set: (text) => set({ text }),
  clear: () => set({ text: "" }),
}));
