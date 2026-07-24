export interface MotionLayerLabelColor {
  readonly name: string;
  readonly color: string;
}

/** AE-inspired, contrast-safe organizational colors for Motion layer labels. */
export const MOTION_LAYER_LABEL_COLORS: readonly MotionLayerLabelColor[] = [
  { name: "Red", color: "#ef6a6a" },
  { name: "Orange", color: "#ed9b4c" },
  { name: "Yellow", color: "#d9bd4a" },
  { name: "Green", color: "#5fba7d" },
  { name: "Teal", color: "#36b8ad" },
  { name: "Blue", color: "#5d91d8" },
  { name: "Indigo", color: "#7776d8" },
  { name: "Violet", color: "#a773d1" },
  { name: "Pink", color: "#dc77a5" },
  { name: "Brown", color: "#a77a62" },
  { name: "Slate", color: "#7d8b9e" },
  { name: "White", color: "#cbd2dc" },
] as const;
