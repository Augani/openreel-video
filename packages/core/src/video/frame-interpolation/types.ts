export interface FlowField {
  width: number;
  height: number;
  vectors: Float32Array;
}

export interface InterpolationConfig {
  quality: "low" | "medium" | "high";
  blockSize: number;
  searchRadius: number;
  pyramidLevels: number;
}

export interface FrameInterpolationResult {
  frame: ImageBitmap;
  computeTimeMs: number;
  method: "optical-flow" | "blend";
}

export const INTERPOLATION_QUALITY_PRESETS: Record<string, InterpolationConfig> = {
  low: { quality: "low", blockSize: 16, searchRadius: 16, pyramidLevels: 2 },
  medium: {
    quality: "medium",
    blockSize: 8,
    searchRadius: 24,
    pyramidLevels: 3,
  },
  high: { quality: "high", blockSize: 8, searchRadius: 32, pyramidLevels: 4 },
};
