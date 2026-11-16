import { BUILT_IN_WORKSPACES, useWorkspaceLayoutStore } from "../stores/workspace-layout-store";
import { useOnboardingStore } from "../stores/onboarding-store";

/**
 * Applying a workspace chosen during onboarding (spec 2.3). The Pro row can run before the editor has
 * ever mounted, so the choice is stored in the onboarding store and applied once on the first editor
 * mount, by wrapping `useWorkspaceLayoutStore.applyWorkspace` (dock geometry, section, mixer, chat).
 */

/** The workspaces the Pro row offers. Built-ins only, so a stored id can never point at a deleted one. */
export const ONBOARDING_WORKSPACES = BUILT_IN_WORKSPACES.filter((w) =>
  ["editing", "color", "audio"].includes(w.id),
);

export function isOnboardingWorkspace(id: string | undefined): id is string {
  return typeof id === "string" && ONBOARDING_WORKSPACES.some((w) => w.id === id);
}

const APPLIED_KEY = "openreel-onboarding-workspace-applied";

function readApplied(): string | null {
  try {
    return localStorage.getItem(APPLIED_KEY);
  } catch {
    return appliedFallback;
  }
}

function writeApplied(id: string | null): void {
  appliedFallback = id;
  try {
    if (id === null) localStorage.removeItem(APPLIED_KEY);
    else localStorage.setItem(APPLIED_KEY, id);
  } catch {
    // storage blocked: the in-memory fallback still stops a second apply this session
  }
}

/** Remembers what was applied so a later launch never overrides a layout the user chose since. */
let appliedFallback: string | null = null;

/** Record the choice. It is applied on first editor mount (`applyPendingWorkspace`). */
export function chooseOnboardingWorkspace(id: string): boolean {
  if (!isOnboardingWorkspace(id)) return false;
  useOnboardingStore.getState().setWorkspace(id);
  // A new explicit choice must apply even if an earlier one already did.
  writeApplied(null);
  return true;
}

/**
 * Apply the chosen workspace once. Safe to call on every editor mount: a no-op when nothing was chosen,
 * when this choice was already applied (it is remembered across launches), or when the editor is already on that workspace.
 */
export function applyPendingWorkspace(): boolean {
  const id = useOnboardingStore.getState().workspace;
  if (!isOnboardingWorkspace(id) || readApplied() === id) return false;
  writeApplied(id);
  const layout = useWorkspaceLayoutStore.getState();
  if (layout.activeId === id) return false;
  return layout.applyWorkspace(id);
}

/** Test seam. */
export function resetWorkspaceApplyForTests(): void {
  writeApplied(null);
}
