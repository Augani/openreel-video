import {
  getMotionLayerPropertyValueAtTime,
  upsertMotionLayerKeyframe,
  type MotionAnimatableProperty,
} from "./motion-keyframes";
import type { MotionComposition, MotionLayer } from "./types";

const TWEEN_PROPERTIES: readonly MotionAnimatableProperty[] = [
  "transform.position.x",
  "transform.position.y",
  "transform.scale.x",
  "transform.scale.y",
  "transform.rotation",
];

function localValue(
  composition: MotionComposition,
  layer: MotionLayer,
  property: MotionAnimatableProperty,
  localTime: number,
): number {
  return getMotionLayerPropertyValueAtTime(
    layer,
    property,
    Math.max(0, localTime),
    composition,
  );
}

/**
 * Morph layer A into layer B over a window starting at `time`: A fades out
 * while B fades in starting from A's transform and tweening to its own — so B
 * appears where A was and settles into place. Both layers should overlap the
 * morph window. Returns null if either layer is missing or they are the same.
 */
export function morphMotionLayers(
  composition: MotionComposition,
  fromLayerId: string,
  toLayerId: string,
  options: { readonly time?: number; readonly duration?: number } = {},
): MotionComposition | null {
  const from = composition.layers.find((layer) => layer.id === fromLayerId);
  const to = composition.layers.find((layer) => layer.id === toLayerId);
  if (!from || !to || from.id === to.id) return null;

  const duration = options.duration ?? 0.6;
  const t0 = options.time ?? 0;
  const t1 = t0 + duration;
  // Both layers must be on-screen during the morph window, otherwise the
  // layer-local keyframe times collapse/clamp and the crossfade is a silent
  // no-op. Bail so the caller can keep the composition untouched.
  const overlaps = (layer: MotionLayer): boolean =>
    layer.startTime < t1 && layer.startTime + layer.duration > t0;
  if (!overlaps(from) || !overlaps(to)) return null;
  const fromStart = t0 - from.startTime;
  const fromEnd = t1 - from.startTime;
  const toStart = t0 - to.startTime;
  const toEnd = t1 - to.startTime;

  let fromNext = from;
  const fromOpacity = localValue(composition, from, "transform.opacity", fromStart);
  fromNext = upsertMotionLayerKeyframe(fromNext, "transform.opacity", fromStart, {
    value: fromOpacity,
    easing: "ease-in",
  });
  fromNext = upsertMotionLayerKeyframe(fromNext, "transform.opacity", fromEnd, {
    value: 0,
    easing: "ease-in",
  });

  let toNext = to;
  const toOpacity = localValue(composition, to, "transform.opacity", toEnd);
  toNext = upsertMotionLayerKeyframe(toNext, "transform.opacity", toStart, {
    value: 0,
    easing: "ease-out",
  });
  toNext = upsertMotionLayerKeyframe(toNext, "transform.opacity", toEnd, {
    value: toOpacity,
    easing: "ease-out",
  });
  for (const property of TWEEN_PROPERTIES) {
    const start = localValue(composition, from, property, fromStart);
    const end = localValue(composition, to, property, toEnd);
    toNext = upsertMotionLayerKeyframe(toNext, property, toStart, {
      value: start,
      easing: "ease-out",
    });
    toNext = upsertMotionLayerKeyframe(toNext, property, toEnd, {
      value: end,
      easing: "ease-out",
    });
  }

  return {
    ...composition,
    layers: composition.layers.map((layer) =>
      layer.id === fromLayerId ? fromNext : layer.id === toLayerId ? toNext : layer,
    ),
    modifiedAt: Date.now(),
  };
}
