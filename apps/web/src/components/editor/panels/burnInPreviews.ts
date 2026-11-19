import { BURN_IN_EFFECT_TYPES, BURN_IN_SPECS, type BurnInEffectType } from "@openreel/core";
import type { CSSProperties } from "react";
import type { EditorEffectPreviewDef } from "./EffectsTransitionsPanel";

/** CSS stand-in for the hover animation of the instant-preview fallback; the card itself shows the engine's real text. */
const PREVIEW_STYLES: Record<BurnInEffectType, (p: number) => CSSProperties> = {
  "burn-in-timecode": (p) => ({
    boxShadow: `inset 0 -${Math.round(8 + p * 4)}px 0 rgba(0,0,0,0.45)`,
  }),
  "burn-in-name": (p) => ({
    boxShadow: `inset 0 ${Math.round(8 + p * 4)}px 0 rgba(0,0,0,0.45)`,
  }),
};

/** Effects panel entries for the text burn-ins (Premiere Timecode and Clip Name), listed under Generate. */
export const BURN_IN_PREVIEWS: EditorEffectPreviewDef[] = BURN_IN_EFFECT_TYPES.map((type) => ({
  id: type,
  type,
  label: BURN_IN_SPECS[type].label,
  description: BURN_IN_SPECS[type].description,
  category: "Generate",
  previewStyle: PREVIEW_STYLES[type],
}));
