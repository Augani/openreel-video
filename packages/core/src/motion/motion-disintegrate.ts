import { applyMotionAnimationPreset } from "./motion-animation-presets";
import { createMotionParticleLayer } from "./motion-particles";
import type { MotionComposition, MotionLayer } from "./types";

export interface DisintegrateMotionLayerResult {
  readonly composition: MotionComposition;
  readonly particleLayerId: string;
}

function layerAccentColor(layer: MotionLayer): string {
  if (layer.type === "shape" && layer.style.fill.type === "solid") {
    return layer.style.fill.color ?? "#67e8f9";
  }
  if (layer.type === "text") return layer.style.color ?? "#67e8f9";
  return "#67e8f9";
}

export function disintegrateMotionLayer(
  composition: MotionComposition,
  layerId: string,
  options: { readonly time?: number; readonly duration?: number } = {},
): DisintegrateMotionLayerResult | null {
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer) return null;

  const duration = options.duration ?? 0.7;
  // `startTime` is composition-absolute (used for the burst layer); the fade
  // preset writes layer-local keyframe times, so it needs the local offset.
  const startTime = options.time ?? layer.startTime;
  const localStart = Math.max(0, Number((startTime - layer.startTime).toFixed(4)));
  const fadedLayer = applyMotionAnimationPreset(layer, "fade-out", {
    startTime: localStart,
    duration,
  });
  // Trim the original so it ends at the disintegration point instead of
  // lingering invisible at opacity 0 for the rest of its duration.
  const trimmedLayer = {
    ...fadedLayer,
    duration: Math.max(0.001, Number((localStart + duration).toFixed(4))),
  };

  const color = layerAccentColor(layer);
  const burst = createMotionParticleLayer(composition, {
    name: `${layer.name} Disintegrate`,
    position: {
      x: layer.transform.position.x,
      y: layer.transform.position.y,
    },
    duration: composition.duration,
    emitter: {
      emissionRate: 260,
      maxParticles: 420,
      lifetime: Math.max(0.45, duration),
      speed: 320,
      spread: 360,
      gravity: 140,
      size: 8,
      sizeRandomness: 0.6,
      opacityStart: 1,
      opacityEnd: 0,
      colorStart: color,
      colorEnd: color,
      seed: 2027,
      shape: "circle",
    },
  });
  const timedBurst: MotionLayer = {
    ...burst,
    startTime,
    duration: Math.max(duration + 0.6, 1),
  };

  return {
    composition: {
      ...composition,
      layers: composition.layers
        .map((candidate) => (candidate.id === layerId ? trimmedLayer : candidate))
        .concat(timedBurst),
      modifiedAt: Date.now(),
    },
    particleLayerId: timedBurst.id,
  };
}
