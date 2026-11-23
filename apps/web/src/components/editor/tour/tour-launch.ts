import { useSyncExternalStore } from "react";

/**
 * The spotlight tours (and framer-motion with them) are not first-paint code. The editor mounts the lazy tour host only on the
 * web build (the first-run tour auto-starts there) or once a tour was asked for, e.g. from Help > Editor tour. The desktop app
 * never auto-starts the passive tour, so it does not load the tour chunk at all until then.
 */
let requested = false;
const listeners = new Set<() => void>();

export function requestTourHost(): void {
  if (requested) return;
  requested = true;
  for (const listener of [...listeners]) listener();
}

export function useTourHostRequested(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => requested,
    () => requested,
  );
}

/** Opens the editor tour (loads the tour chunk on first use). */
export function launchEditorTour(): void {
  requestTourHost();
  void import("./useTour").then((module) => module.startTour());
}

/** Opens the animation and effects tour (loads the tour chunk on first use). */
export function launchMoGraphTour(): void {
  requestTourHost();
  void import("./useMoGraphTour").then((module) => module.startMoGraphTour());
}
