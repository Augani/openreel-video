import type { ComponentType } from "react";

/**
 * Frozen Phase 0 contract for the lazy onboarding sheets.
 * Each of ai/learn/pro/agent has an index.ts whose default export is a `SheetComponent`,
 * so the host can do `lazy(() => import("./ai"))`. Sheets render themselves full-screen
 * (fixed inset-0 z-50 pt-11) and call `onClose` for Esc / close / completion.
 */
export interface OnboardingSheetProps {
  /** Closes the sheet. The host also clears `openSheet` in the onboarding store. */
  onClose: () => void;
}

export type SheetComponent = ComponentType<OnboardingSheetProps>;
