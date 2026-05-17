import type { ShapeStyle } from "../graphics/types";
import type { TextStyle } from "../text/types";
import type { Transform } from "../types/timeline";
import type {
  EditingTemplate,
  EditingTemplateBinding,
  EditingTemplateControlDefinition,
  EditingTemplateEmphasisAnimation,
  EditingTemplateKeyframe,
  EditingTemplatePrimitive,
  EditingTemplateRangeTiming,
  EditingTemplateResolutionContext,
  EditingTemplateTransform,
  EditingTemplateValue,
  ResolvedEditingTemplateApplication,
  ResolvedEditingTemplateEffect,
  ResolvedEditingTemplateKeyframe,
  ResolvedEditingTemplateOverlay,
  ResolvedEditingTemplateTiming,
} from "./types";

const DEFAULT_TRANSFORM: Transform = {
  position: { x: 0.5, y: 0.5 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

const VARIABLE_PATTERN = /\{([^}]+)\}/g;

export function isEditingTemplateBinding(
  value: EditingTemplateValue,
): value is EditingTemplateBinding {
  return typeof value === "object" && value !== null && "controlId" in value;
}

export function getEditingTemplateDefaultControlValues(
  template: EditingTemplate,
): Record<string, EditingTemplatePrimitive> {
  return (template.controls || []).reduce<Record<string, EditingTemplatePrimitive>>(
    (values, control) => {
      values[control.id] = control.defaultValue;
      return values;
    },
    {},
  );
}

export function resolveEditingTemplateControlValues(
  template: EditingTemplate,
  overrides: Readonly<Record<string, EditingTemplatePrimitive>> = {},
): Record<string, EditingTemplatePrimitive> {
  return {
    ...getEditingTemplateDefaultControlValues(template),
    ...overrides,
  };
}

export function resolveEditingTemplate(
  template: EditingTemplate,
  context: EditingTemplateResolutionContext,
  overrides: Readonly<Record<string, EditingTemplatePrimitive>> = {},
): ResolvedEditingTemplateApplication {
  const controlValues = resolveEditingTemplateControlValues(template, overrides);

  return {
    template,
    controlValues,
    effects: template.recipe.effects.map((effect, index) =>
      resolveEffect(effect, context, controlValues, index),
    ),
    audioEffects: template.recipe.audioEffects.map((effect, index) =>
      resolveEffect(effect, context, controlValues, index),
    ),
    overlays: template.recipe.overlays.map((overlay, index) =>
      resolveOverlay(overlay, context, controlValues, index),
    ),
  };
}

export function resolveTemplateVariables(
  value: string,
  context: EditingTemplateResolutionContext,
  controlValues: Readonly<Record<string, EditingTemplatePrimitive>>,
): string {
  const now = context.now ?? new Date();
  const variableMap: Record<string, string> = {
    year: `${now.getFullYear()}`,
    date: now.toISOString().slice(0, 10),
    datetime: now.toISOString(),
    duration: `${context.clip.duration}`,
    "clip.id": context.clip.id,
    "clip.name": context.clip.name ?? "Clip",
  };

  return value.replace(VARIABLE_PATTERN, (_match, token) => {
    if (token.startsWith("control.")) {
      const controlId = token.slice("control.".length);
      return `${controlValues[controlId] ?? ""}`;
    }

    return variableMap[token] ?? `{${token}}`;
  });
}

export function resolveOverlayTiming(
  timing: EditingTemplate["recipe"]["overlays"][number]["timing"],
  context: EditingTemplateResolutionContext,
): ResolvedEditingTemplateTiming {
  if (timing === "full") {
    return {
      startTime: context.clip.startTime,
      duration: context.clip.duration,
    };
  }

  if (timing.kind === "intro") {
    const duration = Math.max(0, Math.min(timing.duration, context.clip.duration));
    return {
      startTime: context.clip.startTime,
      duration,
    };
  }

  if (timing.kind === "outro") {
    const duration = Math.max(0, Math.min(timing.duration, context.clip.duration));
    return {
      startTime: context.clip.startTime + Math.max(0, context.clip.duration - duration),
      duration,
    };
  }

  return resolveRangeTiming(timing, context);
}

function resolveRangeTiming(
  timing: EditingTemplateRangeTiming,
  context: EditingTemplateResolutionContext,
): ResolvedEditingTemplateTiming {
  const startOffset =
    timing.unit === "fraction"
      ? timing.start * context.clip.duration
      : timing.start;
  const endOffset =
    timing.unit === "fraction" ? timing.end * context.clip.duration : timing.end;
  const safeStart = clamp(startOffset, 0, context.clip.duration);
  const safeEnd = clamp(endOffset, safeStart, context.clip.duration);

  return {
    startTime: context.clip.startTime + safeStart,
    duration: safeEnd - safeStart,
  };
}

function resolveEffect(
  effect: EditingTemplate["recipe"]["effects"][number],
  context: EditingTemplateResolutionContext,
  controlValues: Readonly<Record<string, EditingTemplatePrimitive>>,
  index: number,
): ResolvedEditingTemplateEffect {
  return {
    id: effect.id || `${effect.type}-${index + 1}`,
    type: effect.type,
    enabled: effect.enabled ?? true,
    params: resolveRecord(effect.params, context, controlValues),
    keyframes: resolveEffectKeyframes(
      effect.keyframes || [],
      context,
      controlValues,
    ),
  };
}

function resolveOverlay(
  overlay: EditingTemplate["recipe"]["overlays"][number],
  context: EditingTemplateResolutionContext,
  controlValues: Readonly<Record<string, EditingTemplatePrimitive>>,
  index: number,
): ResolvedEditingTemplateOverlay {
  const timing = resolveOverlayTiming(overlay.timing, context);
  const resolvedTransform = resolveTransform(overlay.transform, context, controlValues);
  const blendOpacity =
    overlay.blendOpacity === undefined
      ? undefined
      : toNumber(resolveValue(overlay.blendOpacity, context, controlValues), 1);
  const emphasisAnimation = resolveEmphasisAnimation(
    overlay.emphasisAnimation,
    context,
    controlValues,
  );
  const keyframes = resolveOverlayKeyframes(
    overlay.keyframes || [],
    timing.duration,
    context,
    controlValues,
  );
  const id = overlay.id || `${overlay.type}-${index + 1}`;

  if (overlay.type === "text") {
    return {
      id,
      type: "text",
      trackType: "text",
      timing,
      transform: resolvedTransform,
      blendMode: overlay.blendMode,
      blendOpacity,
      emphasisAnimation,
      keyframes,
      content: {
        text: resolveTemplateVariables(overlay.content.text, context, controlValues),
        style: resolveRecord(
          overlay.content.style || {},
          context,
          controlValues,
        ) as Partial<TextStyle>,
        animation: overlay.content.animation,
      },
    };
  }

  if (overlay.type === "shape") {
    return {
      id,
      type: "shape",
      trackType: "graphics",
      timing,
      transform: resolvedTransform,
      blendMode: overlay.blendMode,
      blendOpacity,
      emphasisAnimation,
      keyframes,
      content: {
        shapeType: overlay.content.shapeType,
        width: toNumber(resolveValue(overlay.content.width, context, controlValues), 0),
        height: toNumber(resolveValue(overlay.content.height, context, controlValues), 0),
        style: resolveRecord(
          overlay.content.style || {},
          context,
          controlValues,
        ) as Partial<ShapeStyle>,
      },
    };
  }

  return {
    id,
    type: "image",
    trackType: "graphics",
    timing,
    transform: resolvedTransform,
    blendMode: overlay.blendMode,
    blendOpacity,
    emphasisAnimation,
    keyframes,
    content: {
      assetId: overlay.content.assetId,
      imageUrl: overlay.content.imageUrl
        ? resolveTemplateVariables(overlay.content.imageUrl, context, controlValues)
        : overlay.content.assetId
          ? context.assetUrls?.[overlay.content.assetId]
          : undefined,
      name: overlay.content.name,
    },
  };
}

function resolveEffectKeyframes(
  keyframes: readonly EditingTemplateKeyframe[],
  context: EditingTemplateResolutionContext,
  controlValues: Readonly<Record<string, EditingTemplatePrimitive>>,
): readonly ResolvedEditingTemplateKeyframe[] {
  return keyframes.map((keyframe) => ({
    time: clamp(keyframe.time, 0, 1) * context.clip.duration,
    property: keyframe.property.startsWith("effect.")
      ? keyframe.property
      : `effect.${keyframe.property}`,
    value: resolveValue(keyframe.value, context, controlValues),
    easing: keyframe.easing || "linear",
  }));
}

function resolveOverlayKeyframes(
  keyframes: readonly EditingTemplateKeyframe[],
  duration: number,
  context: EditingTemplateResolutionContext,
  controlValues: Readonly<Record<string, EditingTemplatePrimitive>>,
): readonly ResolvedEditingTemplateKeyframe[] {
  return keyframes.map((keyframe) => ({
    time: clamp(keyframe.time, 0, 1) * duration,
    property: keyframe.property,
    value: resolveValue(keyframe.value, context, controlValues),
    easing: keyframe.easing || "linear",
  }));
}

function resolveTransform(
  transform: EditingTemplateTransform | undefined,
  context: EditingTemplateResolutionContext,
  controlValues: Readonly<Record<string, EditingTemplatePrimitive>>,
): Transform {
  return {
    position: {
      x: toNumber(resolveNestedValue(transform?.position?.x, context, controlValues), DEFAULT_TRANSFORM.position.x),
      y: toNumber(resolveNestedValue(transform?.position?.y, context, controlValues), DEFAULT_TRANSFORM.position.y),
    },
    scale: {
      x: toNumber(resolveNestedValue(transform?.scale?.x, context, controlValues), DEFAULT_TRANSFORM.scale.x),
      y: toNumber(resolveNestedValue(transform?.scale?.y, context, controlValues), DEFAULT_TRANSFORM.scale.y),
    },
    rotation: toNumber(resolveNestedValue(transform?.rotation, context, controlValues), DEFAULT_TRANSFORM.rotation),
    anchor: {
      x: toNumber(resolveNestedValue(transform?.anchor?.x, context, controlValues), DEFAULT_TRANSFORM.anchor.x),
      y: toNumber(resolveNestedValue(transform?.anchor?.y, context, controlValues), DEFAULT_TRANSFORM.anchor.y),
    },
    opacity: toNumber(resolveNestedValue(transform?.opacity, context, controlValues), DEFAULT_TRANSFORM.opacity),
  };
}

function resolveEmphasisAnimation(
  animation: EditingTemplateEmphasisAnimation | undefined,
  context: EditingTemplateResolutionContext,
  controlValues: Readonly<Record<string, EditingTemplatePrimitive>>,
) {
  if (!animation) {
    return undefined;
  }

  return {
    type: animation.type,
    speed: toNumber(resolveValue(animation.speed, context, controlValues), 1),
    intensity: toNumber(resolveValue(animation.intensity, context, controlValues), 1),
    loop: animation.loop,
    focusPoint: animation.focusPoint
      ? {
          x: toNumber(resolveValue(animation.focusPoint.x, context, controlValues), 0.5),
          y: toNumber(resolveValue(animation.focusPoint.y, context, controlValues), 0.5),
        }
      : undefined,
    zoomScale:
      animation.zoomScale === undefined
        ? undefined
        : toNumber(resolveValue(animation.zoomScale, context, controlValues), 1),
    holdDuration:
      animation.holdDuration === undefined
        ? undefined
        : toNumber(resolveValue(animation.holdDuration, context, controlValues), 0),
    startTime:
      animation.startTime === undefined
        ? undefined
        : toNumber(resolveValue(animation.startTime, context, controlValues), 0),
    animationDuration:
      animation.animationDuration === undefined
        ? undefined
        : toNumber(
            resolveValue(animation.animationDuration, context, controlValues),
            0,
          ),
  };
}

function resolveRecord(
  record: Readonly<Record<string, EditingTemplateValue>>,
  context: EditingTemplateResolutionContext,
  controlValues: Readonly<Record<string, EditingTemplatePrimitive>>,
): Record<string, unknown> {
  return Object.entries(record).reduce<Record<string, unknown>>((resolved, [key, value]) => {
    resolved[key] = resolveValue(value, context, controlValues);
    return resolved;
  }, {});
}

function resolveNestedValue(
  value: EditingTemplateValue | undefined,
  context: EditingTemplateResolutionContext,
  controlValues: Readonly<Record<string, EditingTemplatePrimitive>>,
): unknown {
  if (value === undefined) {
    return undefined;
  }

  return resolveValue(value, context, controlValues);
}

function resolveValue(
  value: EditingTemplateValue,
  context: EditingTemplateResolutionContext,
  controlValues: Readonly<Record<string, EditingTemplatePrimitive>>,
): unknown {
  if (typeof value === "string") {
    return resolveTemplateVariables(value, context, controlValues);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, context, controlValues));
  }

  if (isEditingTemplateBinding(value)) {
    return controlValues[value.controlId];
  }

  return Object.entries(value).reduce<Record<string, unknown>>((resolved, [key, nestedValue]) => {
    resolved[key] = resolveValue(nestedValue, context, controlValues);
    return resolved;
  }, {});
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getEditingTemplateControlDefinition(
  template: EditingTemplate,
  controlId: string,
): EditingTemplateControlDefinition | undefined {
  return template.controls?.find((control) => control.id === controlId);
}