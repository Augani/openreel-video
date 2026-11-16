import type { Effect } from "../types/timeline";

export type LayerType = "image" | "adjustment" | "text" | "shape" | "smart";

export type PhotoBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "softLight"
  | "hardLight"
  | "colorDodge"
  | "colorBurn"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export interface PhotoLayer {
  readonly id: string;
  name: string;
  type: LayerType;
  content: ImageBitmap | null;
  opacity: number;
  blendMode: PhotoBlendMode;
  visible: boolean;
  locked: boolean;
  mask: ImageBitmap | null;
  adjustments: Effect[];
  transform: LayerTransform;
}

export interface LayerTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
}

export interface PhotoProject {
  readonly id: string;
  name: string;
  width: number;
  height: number;
  layers: PhotoLayer[];
  selectedLayerIndex: number;
  backgroundColor: string;
}

export type AdjustmentType =
  | "brightness"
  | "contrast"
  | "saturation"
  | "temperature"
  | "exposure"
  | "highlights"
  | "shadows"
  | "whites"
  | "blacks"
  | "vibrance"
  | "clarity";

export interface AdjustmentParams {
  brightness: { value: number }; // -1 to 1
  contrast: { value: number }; // 0 to 2
  saturation: { value: number }; // 0 to 2
  temperature: { value: number }; // -1 to 1 (cool to warm)
  exposure: { value: number }; // -2 to 2
  highlights: { value: number }; // -1 to 1
  shadows: { value: number }; // -1 to 1
  whites: { value: number }; // -1 to 1
  blacks: { value: number }; // -1 to 1
  vibrance: { value: number }; // -1 to 1
  clarity: { value: number }; // -1 to 1
}

export interface BrushStroke {
  points: BrushPoint[];
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
}

export interface BrushPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface CloneSource {
  x: number;
  y: number;
  layerId: string | null;
}

export interface CreateLayerOptions {
  name?: string;
  type?: LayerType;
  content?: ImageBitmap;
  opacity?: number;
  blendMode?: PhotoBlendMode;
  insertAt?: number;
}

export interface ReorderResult {
  success: boolean;
  layers: PhotoLayer[];
  error?: string;
}

export interface CompositeOptions {
  width?: number;
  height?: number;
  includeHidden?: boolean;
  backgroundColor?: string;
}

export const DEFAULT_LAYER_TRANSFORM: LayerTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  anchorX: 0.5,
  anchorY: 0.5,
};

export const DEFAULT_BLEND_MODE: PhotoBlendMode = "normal";

export const DEFAULT_LAYER_OPACITY = 1;
