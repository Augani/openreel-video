export type UpscaleQuality = "fast" | "balanced" | "quality";

export interface UpscalingSettings {
  enabled: boolean;
  quality: UpscaleQuality;
  sharpening: number;
}

export const DEFAULT_UPSCALING_SETTINGS: UpscalingSettings = {
  enabled: false,
  quality: "balanced",
  sharpening: 0.3,
};

export interface UpscalingConfig {
  device: GPUDevice;
  maxTextureSize?: number;
}

export interface TexturePoolEntry {
  texture: GPUTexture;
  width: number;
  height: number;
  lastUsed: number;
}
