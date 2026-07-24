import type {
  MotionComposition,
  MotionLayer,
  MotionRenderQuality,
} from "@openreel/core";
import {
  getMotionCompositionLayerSource,
  hasActiveMotionCamera,
  hasActiveMotionLights,
  layerHasMotionShaderEffects,
  layerHasMotionShaderFill,
  layerHasMotionShaderTextAnimator,
  layerMayUseAdvancedMotionMasks,
  motionLayerMayUse3D,
} from "@openreel/core";

export type MotionStagePreviewMode = "draft" | "final";
export type MotionStagePreviewResolution = "full" | "half" | "quarter";

export interface MotionStagePreviewSettings {
  readonly mode: MotionStagePreviewMode;
  readonly resolution: MotionStagePreviewResolution;
}

export const DEFAULT_MOTION_STAGE_PREVIEW_SETTINGS: MotionStagePreviewSettings = {
  mode: "final",
  resolution: "full",
};

const RESOLUTION_SCALE: Record<MotionStagePreviewResolution, number> = {
  full: 1,
  half: 0.5,
  quarter: 0.25,
};

const RENDER_QUALITY: Record<MotionStagePreviewResolution, MotionRenderQuality> = {
  full: { shadows: true, shadowMapSize: 2048, environment: true },
  half: { shadows: true, shadowMapSize: 1024, environment: true },
  quarter: { shadows: false, shadowMapSize: 0, environment: false },
};

export function getMotionStagePreviewRenderQuality(
  resolution: MotionStagePreviewResolution,
): MotionRenderQuality {
  return RENDER_QUALITY[resolution] ?? RENDER_QUALITY.full;
}

function layerHasMotionShader(layer: MotionLayer): boolean {
  return (
    layerHasMotionShaderEffects(layer) ||
    layerHasMotionShaderFill(layer) ||
    layerHasMotionShaderTextAnimator(layer)
  );
}

export function layerUsesRendererPreview(layer: MotionLayer): boolean {
  if (layer.type === "particle") return true;
  if (layer.type === "video") return true;
  if (layer.type === "scene3d") return true;
  if (layer.type === "adjustment") return true;
  if (
    layer.type === "group" &&
    ((layer.effects ?? []).some((effect) => effect.enabled) ||
      (layer.blendMode ?? "normal") !== "normal")
  ) {
    return true;
  }
  if (motionLayerMayUse3D(layer)) return true;
  if (layer.trackMatte?.enabled) return true;
  if (layerMayUseAdvancedMotionMasks(layer)) return true;
  if (layerHasMotionShader(layer)) return true;
  return false;
}

export function compositionHasMotionShaderLayers(
  composition: MotionComposition,
): boolean {
  return composition.layers.some((layer) => layerHasMotionShader(layer));
}

export function needsRendererBackedStagePreview(
  composition: MotionComposition,
  compositionLibrary: readonly MotionComposition[],
  visited = new Set<string>(),
): boolean {
  if (visited.has(composition.id)) return false;
  visited.add(composition.id);
  if (hasActiveMotionCamera(composition)) return true;
  if (hasActiveMotionLights(composition)) return true;

  return composition.layers.some((layer) => {
    if (layerUsesRendererPreview(layer)) return true;
    if (layer.type !== "composition") return false;
    const source = getMotionCompositionLayerSource(compositionLibrary, layer);
    return source
      ? needsRendererBackedStagePreview(source, compositionLibrary, visited)
      : false;
  });
}

export function shouldUseRendererBackedStagePreview(
  composition: MotionComposition,
  compositionLibrary: readonly MotionComposition[],
  settings: MotionStagePreviewSettings = DEFAULT_MOTION_STAGE_PREVIEW_SETTINGS,
): boolean {
  if (compositionHasMotionShaderLayers(composition)) {
    return true;
  }
  if (settings.mode !== "final") {
    return false;
  }
  return (
    composition.layers.length > 0 ||
    needsRendererBackedStagePreview(composition, compositionLibrary)
  );
}

export function getMotionStagePreviewResolutionScale(
  resolution: MotionStagePreviewResolution,
): number {
  return RESOLUTION_SCALE[resolution] ?? RESOLUTION_SCALE.full;
}

export function getMotionStagePreviewCanvasSize(
  width: number,
  height: number,
  resolution: MotionStagePreviewResolution,
): { readonly width: number; readonly height: number; readonly scale: number } {
  const scale = getMotionStagePreviewResolutionScale(resolution);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export function getMotionStagePreviewFrameStepSeconds(
  frameRate: number,
  settings: MotionStagePreviewSettings,
): number | null {
  const safeFrameRate = Math.max(1, Number.isFinite(frameRate) ? frameRate : 30);
  const frameSkip =
    settings.resolution === "quarter" ? 4 : settings.resolution === "half" ? 2 : 1;
  return frameSkip / safeFrameRate;
}

/**
 * Keep the full-resolution frame for scrubbing and paused inspection, but avoid
 * asking the renderer to produce export-sized frames in real time. The UI calls
 * the full setting "Adaptive", so its playback quality should actually adapt.
 */
export function getMotionStagePlaybackPreviewSettings(
  settings: MotionStagePreviewSettings,
  isPlaying: boolean,
): MotionStagePreviewSettings {
  if (!isPlaying || settings.resolution !== "full") return settings;
  return { ...settings, resolution: "half" };
}

export function normalizeMotionStagePreviewSettings(
  settings: Partial<MotionStagePreviewSettings>,
): MotionStagePreviewSettings {
  return {
    mode: settings.mode === "draft" ? "draft" : "final",
    resolution:
      settings.resolution === "quarter" || settings.resolution === "half"
        ? settings.resolution
        : "full",
  };
}
