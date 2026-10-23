/**
 * The simple editor (Hawsh Khalifa build, owner's decision 2026-10-23: "a simple, light, practical
 * version"). Features listed here are hidden from the UI only — the code stays, so any of them comes
 * back by removing it from these lists, and upstream OpenReel merges stay clean.
 */

/** Left tool rail tabs (AssetsPanel). */
export const HIDDEN_ASSET_TABS: ReadonlySet<string> = new Set(["recipes", "templates"]);

/** AI Generate tiles: duplicates of the site (voice, music) or not needed in short-form edits. */
export const HIDDEN_AI_FEATURES: ReadonlySet<string> = new Set(["tts", "templates", "music", "multicam"]);

/** Inspector sections (InspectorSection sectionId): pro tools rarely used in reels and ads. */
export const HIDDEN_INSPECTOR_SECTIONS: ReadonlySet<string> = new Set([
  "keyframes",
  "multicam",
  "motion-tracking",
  "masking",
  "transform-3d",
  "particle-effects",
  "text-behind-subject",
  "motion-path",
  "color-grading",
  "background-removal",
]);

/** Whole blocks hidden in the simple editor: 3D objects, SVG import, blending, text materials,
 *  screen/camera recording, custom export settings, developer panels. */
export const SIMPLE_EDITOR = true;

export const isHiddenSection = (id: string | undefined): boolean => !!id && HIDDEN_INSPECTOR_SECTIONS.has(id);
