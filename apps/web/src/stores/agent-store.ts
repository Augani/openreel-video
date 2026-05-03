import { create } from "zustand";

/**
 * Tracks whether an external agent has "taken over" the editor. While frozen,
 * the timeline UI overlays a non-interactive scrim and keyboard shortcuts
 * short-circuit, so the agent's edits and scrubs aren't fighting the user.
 */
export interface AgentState {
  frozen: boolean;
  reason: string | null;
  startedAt: number | null;
  setFrozen(frozen: boolean, reason?: string | null): void;
}

export const useAgentStore = create<AgentState>((set) => ({
  frozen: false,
  reason: null,
  startedAt: null,
  setFrozen: (frozen, reason = null) =>
    set({
      frozen,
      reason: frozen ? reason : null,
      startedAt: frozen ? Date.now() : null,
    }),
}));
