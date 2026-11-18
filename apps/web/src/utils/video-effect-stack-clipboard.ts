import type { VideoEffect } from "../bridges/effects-bridge";

let clipboard: VideoEffect[] | null = null;
const listeners = new Set<() => void>();

export function copyVideoEffectStack(effects: readonly VideoEffect[]): void {
  clipboard = effects.map((effect) => structuredClone(effect));
  listeners.forEach(listener => listener());
}

export function subscribeToVideoEffectStackClipboard(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function hasVideoEffectStackClipboard(): boolean {
  return clipboard !== null;
}

export function cloneVideoEffectStackWithFreshIds(): VideoEffect[] | null {
  if (!clipboard) return null;
  const stamp = Date.now();
  return clipboard.map((effect, index) => ({
    ...structuredClone(effect),
    id: `effect-${stamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
  }));
}
