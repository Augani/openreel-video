export type HandlePosition = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type InteractionMode = "none" | "move" | "resize";

export type FitMode = "contain" | "cover" | "stretch" | "none";

export interface ClipTransform {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  opacity: number;
  anchor: { x: number; y: number };
  borderRadius?: number;
  fitMode?: FitMode;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export const DEFAULT_TRANSFORM: ClipTransform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
  anchor: { x: 0.5, y: 0.5 },
  borderRadius: 0,
  fitMode: "contain",
};
