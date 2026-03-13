/**
 * Lightweight Zustand store for TTS audio state that persists across
 * component mount/unmount cycles (e.g. switching inspector tabs).
 *
 * Only holds the generated audio blob and its "saved" status so the
 * user doesn't lose unsaved audio when navigating away from the TTS panel.
 */
import { create } from "zustand";

interface TtsAudioState {
  /** The most recently generated audio blob, or null. */
  generatedAudio: Blob | null;
  /** Whether the current audio has been saved/downloaded. */
  isAudioSaved: boolean;
  /** Object URL for the current audio blob (for <audio> playback). */
  audioUrl: string | null;

  setGeneratedAudio: (blob: Blob | null) => void;
  markAudioSaved: () => void;
  clearAudio: () => void;
}

export const useTtsAudioStore = create<TtsAudioState>((set, get) => ({
  generatedAudio: null,
  isAudioSaved: false,
  audioUrl: null,

  setGeneratedAudio: (blob) => {
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);

    if (!blob) {
      set({ generatedAudio: null, isAudioSaved: false, audioUrl: null });
      return;
    }

    const url = URL.createObjectURL(blob);
    set({ generatedAudio: blob, isAudioSaved: false, audioUrl: url });
  },

  markAudioSaved: () => set({ isAudioSaved: true }),

  clearAudio: () => {
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({ generatedAudio: null, isAudioSaved: false, audioUrl: null });
  },
}));
