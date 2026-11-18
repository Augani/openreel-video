import type { Keyframe, EasingType, Transform, Effect } from "@openreel/core";
import {
  effectInstanceKeyframeProperty,
  parseEffectInstanceKeyframeProperty,
} from "@openreel/core/video/effect-instance-keyframes";

export const CLIP_ANIMATION_PRESETS = [
  "none", "fade", "slide-left", "slide-right", "slide-up", "slide-down",
  "zoom-in", "zoom-out", "rotate", "blur", "iris-circle", "iris-rectangle",
  "iris-diamond", "iris-star",
] as const;
export type TransitionPreset = (typeof CLIP_ANIMATION_PRESETS)[number];

export interface TransitionConfig {
  preset: TransitionPreset;
  duration: number;
  easing: EasingType;
}

export interface ClipLike {
  id: string;
  trackId?: string;
  duration: number;
  transform: Transform;
  keyframes?: Keyframe[];
  /** Effect stack; blur animates the instances found here (fx:<id>:radius). */
  effects?: readonly Pick<Effect, "id" | "type">[];
}

/**
 * Blur keyframe properties for a clip. Instance-keyed ids win over type-keyed
 * ones in the sampler, so a clip that already carries blur effects must be
 * keyed on those instances. Without an instance the type-keyed id is kept: the
 * sampler synthesises the effect and nothing can override it.
 */
function blurProperties(clip: ClipLike, clipType: ClipType): string[] {
  const instances = (clip.effects ?? []).filter((effect) => effect.type === "blur");
  if (clipType === "regular" && instances.length > 0) {
    return instances.map((effect) => effectInstanceKeyframeProperty(effect.id, "radius"));
  }
  return [clipType === "regular" ? "effect.blur" : "blur"];
}

function isBlurProperty(clip: ClipLike, property: string): boolean {
  if (property === "blur" || property === "effect.blur") return true;
  const ref = parseEffectInstanceKeyframeProperty(property);
  return ref !== null && ref.param === "radius" &&
    (clip.effects ?? []).some((effect) => effect.id === ref.effectId && effect.type === "blur");
}

export type ClipType = "regular" | "text" | "graphic";

interface CanvasDimensions {
  width: number;
  height: number;
}

function boundedAnimationDuration(value: number, clipDuration: number): number {
  const max = Number.isFinite(clipDuration) ? Math.max(0, clipDuration / 2) : 0;
  return Math.min(max, Math.max(Math.min(0.1, max), Number.isFinite(value) ? value : 0.5));
}

function calculateSlideOffsets(
  baseTransform: Transform,
  canvas: CanvasDimensions,
  clipType: ClipType,
): { left: number; right: number; up: number; down: number } {
  const unitX = clipType === "regular" ? Math.max(1, canvas.width) : 1;
  const unitY = clipType === "regular" ? Math.max(1, canvas.height) : 1;
  const origin = clipType === "regular" ? 0.5 : 0;
  const posX = baseTransform.position.x / unitX + origin;
  const posY = baseTransform.position.y / unitY + origin;
  const halfWidth = Math.max(1, Math.abs(baseTransform.scale.x)) / 2 + 0.1;
  const halfHeight = Math.max(1, Math.abs(baseTransform.scale.y)) / 2 + 0.1;

  return {
    left: (posX + halfWidth) * unitX,
    right: (1 - posX + halfWidth) * unitX,
    up: (posY + halfHeight) * unitY,
    down: (1 - posY + halfHeight) * unitY,
  };
}

export function generateKeyframes(
  clip: ClipLike,
  entryConfig: TransitionConfig,
  exitConfig: TransitionConfig,
  clipType: ClipType,
  canvas: CanvasDimensions,
): Keyframe[] {
  const keyframes: Keyframe[] = [];
  const baseTransform = clip.transform;
  const duration = Number.isFinite(clip.duration) ? Math.max(0, clip.duration) : 0;
  if (!duration) return [];

  const entryEnd = boundedAnimationDuration(entryConfig.duration, duration);
  const exitStart = duration - boundedAnimationDuration(exitConfig.duration, duration);

  const offsets = calculateSlideOffsets(baseTransform, canvas, clipType);

  if (entryConfig.preset !== "none") {
    switch (entryConfig.preset) {
      case "fade":
        keyframes.push(
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
      case "slide-left":
        keyframes.push(
          {
            id: `kf-entry-pos-0`,
            time: 0,
            property: "position.x",
            value: baseTransform.position.x - offsets.left,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-pos-1`,
            time: entryEnd,
            property: "position.x",
            value: baseTransform.position.x,
            easing: entryConfig.easing,
          },
        );
        break;
      case "slide-right":
        keyframes.push(
          {
            id: `kf-entry-pos-0`,
            time: 0,
            property: "position.x",
            value: baseTransform.position.x + offsets.right,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-pos-1`,
            time: entryEnd,
            property: "position.x",
            value: baseTransform.position.x,
            easing: entryConfig.easing,
          },
        );
        break;
      case "slide-up":
        keyframes.push(
          {
            id: `kf-entry-pos-0`,
            time: 0,
            property: "position.y",
            value: baseTransform.position.y - offsets.up,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-pos-1`,
            time: entryEnd,
            property: "position.y",
            value: baseTransform.position.y,
            easing: entryConfig.easing,
          },
        );
        break;
      case "slide-down":
        keyframes.push(
          {
            id: `kf-entry-pos-0`,
            time: 0,
            property: "position.y",
            value: baseTransform.position.y + offsets.down,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-pos-1`,
            time: entryEnd,
            property: "position.y",
            value: baseTransform.position.y,
            easing: entryConfig.easing,
          },
        );
        break;
      case "zoom-in":
        keyframes.push(
          {
            id: `kf-entry-scale-0`,
            time: 0,
            property: "scale.x",
            value: 0.3 * baseTransform.scale.x,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-1`,
            time: 0,
            property: "scale.y",
            value: 0.3 * baseTransform.scale.y,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-2`,
            time: entryEnd,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-3`,
            time: entryEnd,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
      case "zoom-out":
        keyframes.push(
          {
            id: `kf-entry-scale-0`,
            time: 0,
            property: "scale.x",
            value: 1.8 * baseTransform.scale.x,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-1`,
            time: 0,
            property: "scale.y",
            value: 1.8 * baseTransform.scale.y,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-2`,
            time: entryEnd,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-3`,
            time: entryEnd,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
      case "rotate":
        keyframes.push(
          {
            id: `kf-entry-rot-0`,
            time: 0,
            property: "rotation",
            value: baseTransform.rotation - 90,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-rot-1`,
            time: entryEnd,
            property: "rotation",
            value: baseTransform.rotation,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-0`,
            time: 0,
            property: "scale.x",
            value: 0.5 * baseTransform.scale.x,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-1`,
            time: 0,
            property: "scale.y",
            value: 0.5 * baseTransform.scale.y,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-2`,
            time: entryEnd,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-3`,
            time: entryEnd,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
      case "blur":
        keyframes.push(
          ...blurProperties(clip, clipType).flatMap((property, index) => [
            {
              id: `kf-entry-blur-0${index ? `-i${index}` : ""}`,
              time: 0,
              property,
              value: 30,
              easing: entryConfig.easing,
            },
            {
              id: `kf-entry-blur-1${index ? `-i${index}` : ""}`,
              time: entryEnd,
              property,
              value: 0,
              easing: entryConfig.easing,
            },
          ]),
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
      case "iris-circle":
      case "iris-rectangle":
      case "iris-diamond":
      case "iris-star":
        keyframes.push(
          { id: `kf-entry-reveal-0`, time: 0, property: `effect.${entryConfig.preset}`, value: 0, easing: entryConfig.easing },
          { id: `kf-entry-reveal-1`, time: entryEnd, property: `effect.${entryConfig.preset}`, value: 1, easing: entryConfig.easing },
        );
        break;
    }
  }

  if (exitConfig.preset !== "none") {
    switch (exitConfig.preset) {
      case "fade":
        keyframes.push(
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0,
            easing: exitConfig.easing,
          },
        );
        break;
      case "slide-left":
        keyframes.push(
          {
            id: `kf-exit-pos-0`,
            time: exitStart,
            property: "position.x",
            value: baseTransform.position.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-pos-1`,
            time: duration,
            property: "position.x",
            value: baseTransform.position.x - offsets.left,
            easing: exitConfig.easing,
          },
        );
        break;
      case "slide-right":
        keyframes.push(
          {
            id: `kf-exit-pos-0`,
            time: exitStart,
            property: "position.x",
            value: baseTransform.position.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-pos-1`,
            time: duration,
            property: "position.x",
            value: baseTransform.position.x + offsets.right,
            easing: exitConfig.easing,
          },
        );
        break;
      case "slide-up":
        keyframes.push(
          {
            id: `kf-exit-pos-0`,
            time: exitStart,
            property: "position.y",
            value: baseTransform.position.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-pos-1`,
            time: duration,
            property: "position.y",
            value: baseTransform.position.y - offsets.up,
            easing: exitConfig.easing,
          },
        );
        break;
      case "slide-down":
        keyframes.push(
          {
            id: `kf-exit-pos-0`,
            time: exitStart,
            property: "position.y",
            value: baseTransform.position.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-pos-1`,
            time: duration,
            property: "position.y",
            value: baseTransform.position.y + offsets.down,
            easing: exitConfig.easing,
          },
        );
        break;
      case "zoom-in":
        keyframes.push(
          {
            id: `kf-exit-scale-0`,
            time: exitStart,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-1`,
            time: exitStart,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-2`,
            time: duration,
            property: "scale.x",
            value: 1.8 * baseTransform.scale.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-3`,
            time: duration,
            property: "scale.y",
            value: 1.8 * baseTransform.scale.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0,
            easing: exitConfig.easing,
          },
        );
        break;
      case "zoom-out":
        keyframes.push(
          {
            id: `kf-exit-scale-0`,
            time: exitStart,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-1`,
            time: exitStart,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-2`,
            time: duration,
            property: "scale.x",
            value: 0.3 * baseTransform.scale.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-3`,
            time: duration,
            property: "scale.y",
            value: 0.3 * baseTransform.scale.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0,
            easing: exitConfig.easing,
          },
        );
        break;
      case "rotate":
        keyframes.push(
          {
            id: `kf-exit-rot-0`,
            time: exitStart,
            property: "rotation",
            value: baseTransform.rotation,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-rot-1`,
            time: duration,
            property: "rotation",
            value: baseTransform.rotation + 90,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-0`,
            time: exitStart,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-1`,
            time: exitStart,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-2`,
            time: duration,
            property: "scale.x",
            value: 0.5 * baseTransform.scale.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-3`,
            time: duration,
            property: "scale.y",
            value: 0.5 * baseTransform.scale.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0,
            easing: exitConfig.easing,
          },
        );
        break;
      case "blur":
        keyframes.push(
          ...blurProperties(clip, clipType).flatMap((property, index) => [
            {
              id: `kf-exit-blur-0${index ? `-i${index}` : ""}`,
              time: exitStart,
              property,
              value: 0,
              easing: exitConfig.easing,
            },
            {
              id: `kf-exit-blur-1${index ? `-i${index}` : ""}`,
              time: duration,
              property,
              value: 30,
              easing: exitConfig.easing,
            },
          ]),
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0,
            easing: exitConfig.easing,
          },
        );
        break;
      case "iris-circle":
      case "iris-rectangle":
      case "iris-diamond":
      case "iris-star":
        keyframes.push(
          { id: `kf-exit-reveal-0`, time: exitStart, property: `effect.${exitConfig.preset}`, value: 1, easing: exitConfig.easing },
          { id: `kf-exit-reveal-1`, time: duration, property: `effect.${exitConfig.preset}`, value: 0, easing: exitConfig.easing },
        );
        break;
    }
  }

  return keyframes.map((keyframe) => {
    const entry = keyframe.id.startsWith("kf-entry-");
    const side = entry ? "entry" : "exit";
    const preset = entry ? entryConfig.preset : exitConfig.preset;
    return { ...keyframe, id: keyframe.id.replace(`kf-${side}-`, `kf-${side}-${preset}-`) };
  });
}

export function detectCurrentTransitions(clip: ClipLike): {
  entry: TransitionConfig;
  exit: TransitionConfig;
} {
  const entry: TransitionConfig = {
    preset: "none",
    duration: 0.5,
    easing: "ease-out",
  };
  const exit: TransitionConfig = {
    preset: "none",
    duration: 0.5,
    easing: "ease-in",
  };

  const keyframes = clip.keyframes || [];
  const entryKfs = keyframes.filter((kf) => kf.id.startsWith("kf-entry-"));
  const exitKfs = keyframes.filter((kf) => kf.id.startsWith("kf-exit-"));

  if (entryKfs.length > 0) {
    const opacityKf = entryKfs.find((kf) => kf.property === "opacity");
    const posXKf = entryKfs.find((kf) => kf.property === "position.x");
    const posYKf = entryKfs.find((kf) => kf.property === "position.y");
    const scaleKf = entryKfs.find((kf) => kf.property === "scale.x");
    const rotKf = entryKfs.find((kf) => kf.property === "rotation");
    const blurKf = entryKfs.find((kf) => isBlurProperty(clip, kf.property));

    if (blurKf) entry.preset = "blur";
    else if (rotKf) entry.preset = "rotate";
    else if (scaleKf && Number(scaleKf.value) === 0)
      entry.preset = "iris-circle";
    else if (scaleKf && Number(scaleKf.value) < 1) entry.preset = "zoom-in";
    else if (scaleKf && Number(scaleKf.value) > 1) entry.preset = "zoom-out";
    else if (posXKf && Number(posXKf.value) < clip.transform.position.x)
      entry.preset = "slide-left";
    else if (posXKf && Number(posXKf.value) > clip.transform.position.x)
      entry.preset = "slide-right";
    else if (posYKf && Number(posYKf.value) < clip.transform.position.y)
      entry.preset = "slide-up";
    else if (posYKf && Number(posYKf.value) > clip.transform.position.y)
      entry.preset = "slide-down";
    else if (opacityKf) entry.preset = "fade";

    const maxTime = Math.max(...entryKfs.map((kf) => kf.time));
    if (maxTime > 0) entry.duration = maxTime;
    const firstKf = entryKfs[0];
    if (firstKf) entry.easing = firstKf.easing;
  }

  if (exitKfs.length > 0) {
    const opacityKf = exitKfs.find(
      (kf) => kf.property === "opacity" && kf.time === clip.duration,
    );
    const posXKf = exitKfs.find(
      (kf) => kf.property === "position.x" && kf.time === clip.duration,
    );
    const posYKf = exitKfs.find(
      (kf) => kf.property === "position.y" && kf.time === clip.duration,
    );
    const scaleKf = exitKfs.find(
      (kf) => kf.property === "scale.x" && kf.time === clip.duration,
    );
    const rotKf = exitKfs.find(
      (kf) => kf.property === "rotation" && kf.time === clip.duration,
    );
    const blurKf = exitKfs.find(
      (kf) => isBlurProperty(clip, kf.property) && kf.time === clip.duration,
    );

    if (blurKf) exit.preset = "blur";
    else if (rotKf) exit.preset = "rotate";
    else if (scaleKf && Number(scaleKf.value) === 0)
      exit.preset = "iris-circle";
    else if (scaleKf && Number(scaleKf.value) > 1) exit.preset = "zoom-in";
    else if (scaleKf && Number(scaleKf.value) < 1) exit.preset = "zoom-out";
    else if (posXKf && Number(posXKf.value) < clip.transform.position.x)
      exit.preset = "slide-left";
    else if (posXKf && Number(posXKf.value) > clip.transform.position.x)
      exit.preset = "slide-right";
    else if (posYKf && Number(posYKf.value) < clip.transform.position.y)
      exit.preset = "slide-up";
    else if (posYKf && Number(posYKf.value) > clip.transform.position.y)
      exit.preset = "slide-down";
    else if (opacityKf) exit.preset = "fade";

    const minTime = Math.min(
      ...exitKfs.filter((kf) => kf.id.includes("-0")).map((kf) => kf.time),
    );
    if (minTime < clip.duration) exit.duration = clip.duration - minTime;
    const firstKf = exitKfs[0];
    if (firstKf) exit.easing = firstKf.easing;
  }

  const savedPreset = (side: "entry" | "exit", keys: Keyframe[]) => CLIP_ANIMATION_PRESETS.find(
    (preset) => preset !== "none" && keys.some((key) => key.id.startsWith(`kf-${side}-${preset}-`)),
  );
  entry.preset = savedPreset("entry", entryKfs) ?? entry.preset;
  exit.preset = savedPreset("exit", exitKfs) ?? exit.preset;
  entry.duration = boundedAnimationDuration(entry.duration, clip.duration);
  exit.duration = boundedAnimationDuration(exit.duration, clip.duration);
  return { entry, exit };
}

