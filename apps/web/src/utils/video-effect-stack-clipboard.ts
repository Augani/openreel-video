import type { VideoEffect } from "../bridges/effects-bridge";

let clipboard: VideoEffect[] | null = null;

export function copyVideoEffectStack(effects: readonly VideoEffect[]): void {
  clipboard = effects.map((effect) => structuredClone(effect));
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
