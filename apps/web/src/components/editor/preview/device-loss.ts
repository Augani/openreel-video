import type { Renderer } from "@openreel/core";

/**
 * GPU device-loss plumbing shared by the Program monitor and everything else that holds GPU state on its behalf
 * (the effect-preview cards): the monitor announces a loss, listeners rebuild and re-render.
 */

const listeners = new Set<() => void>();

/** Subscribes to Program-monitor GPU device losses / recoveries. Returns the unsubscribe function. */
export function onPreviewDeviceLoss(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyPreviewDeviceLoss(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn("[Preview] device-loss listener failed:", error);
    }
  }
}

let programRenderer: () => Renderer | null = () => null;

/** Lets diagnostics / the e2e hook reach the Program monitor's current renderer. */
export function registerProgramRenderer(get: () => Renderer | null): void {
  programRenderer = get;
}

export function getProgramRenderer(): Renderer | null {
  return programRenderer();
}
