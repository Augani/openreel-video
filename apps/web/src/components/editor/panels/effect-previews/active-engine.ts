import type { EffectPreviewEngine } from "./preview-engine";

let active: EffectPreviewEngine | null = null;

/** The engine of the mounted Effects panel (null when the panel is closed). Read by the e2e hook. */
export const getActiveEffectPreviewEngine = (): EffectPreviewEngine | null => active;
export const setActiveEffectPreviewEngine = (engine: EffectPreviewEngine | null): void => {
  active = engine;
};
/** Clears the registration only when `engine` is still the registered one (two panels may each own an engine). */
export const clearActiveEffectPreviewEngine = (engine: EffectPreviewEngine): void => {
  if (active === engine) active = null;
};
