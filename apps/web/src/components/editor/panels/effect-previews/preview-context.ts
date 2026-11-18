import { createContext } from "react";
import type { EffectPreviewEngine } from "./preview-engine";

/** The engine of the enclosing Effects / Transitions panel, or null until the lazy runtime has started it. */
export const EffectPreviewContext = createContext<EffectPreviewEngine | null>(null);

/** True when the browser can run the preview pipeline (OffscreenCanvas, ImageBitmap, IntersectionObserver). */
export const effectPreviewsSupported = (): boolean =>
  typeof OffscreenCanvas !== "undefined" &&
  typeof createImageBitmap === "function" &&
  typeof IntersectionObserver !== "undefined";
