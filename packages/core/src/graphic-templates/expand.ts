import type { Keyframe, Transform } from "../types/timeline";
import type { ShapeClip, SVGClip, ShapeStyle } from "../graphics/types";
import { DEFAULT_SHAPE_STYLE } from "../graphics/types";
import type { TextClip, TextStyle } from "../text/types";
import { DEFAULT_TEXT_STYLE } from "../text/types";
import { editRuns, hasRunOverrides, runsForText, scaleRuns } from "../text/rich-text";
import {
  GRAPHIC_DESIGN_WIDTH,
  GRAPHIC_LAYER_ID_KEY,
  GRAPHIC_LAYER_MEMBER_KEY,
  GRAPHIC_MIN_HOLD,
  type GraphicInstance,
  type GraphicLayer,
  type GraphicLayerKeyframe,
  type GraphicMotion,
  type GraphicParamValue,
  type GraphicParameter,
  type GraphicTemplate,
} from "./types";

/** Project canvas in pixels. */
export interface GraphicFrame {
  readonly width: number;
  readonly height: number;
}

export interface ExpandedGraphic {
  readonly textClips: TextClip[];
  readonly shapeClips: ShapeClip[];
  readonly svgClips: SVGClip[];
}

export const graphicMemberId = (instanceId: string, layerId: string): string =>
  `${instanceId}__${layerId}`;

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;
const round = (value: number): number => Math.round(value * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export function defaultParamValues(
  template: Pick<GraphicTemplate, "parameters">,
): Record<string, GraphicParamValue> {
  const values: Record<string, GraphicParamValue> = {};
  for (const parameter of template.parameters) values[parameter.id] = parameter.defaultValue;
  return values;
}

/** Coerce a raw value to the parameter's type and range; undefined when it cannot be used. */
export function coerceParamValue(
  parameter: GraphicParameter,
  raw: unknown,
): GraphicParamValue | undefined {
  switch (parameter.type) {
    case "text":
      return typeof raw === "string" ? raw.slice(0, 2000) : undefined;
    case "font":
      return typeof raw === "string" && raw.length > 0 && raw.length <= 100 ? raw : undefined;
    case "color":
      return typeof raw === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(raw.trim())
        ? raw.trim()
        : undefined;
    case "checkbox":
      return typeof raw === "boolean" ? raw : undefined;
    case "number":
    case "slider": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
      const min = parameter.min ?? -100000;
      const max = parameter.max ?? 100000;
      return Math.min(max, Math.max(min, raw));
    }
    case "position": {
      const point = raw as { x?: unknown; y?: unknown } | null;
      if (!point || typeof point.x !== "number" || typeof point.y !== "number") return undefined;
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
      return { x: point.x, y: point.y };
    }
  }
}

/** Values merged over defaults, coerced, with unknown ids dropped. */
export function resolveParamValues(
  template: Pick<GraphicTemplate, "parameters">,
  values: Readonly<Record<string, unknown>> | undefined,
): Record<string, GraphicParamValue> {
  const resolved = defaultParamValues(template);
  for (const parameter of template.parameters) {
    if (!values || !Object.prototype.hasOwnProperty.call(values, parameter.id)) continue;
    const coerced = coerceParamValue(parameter, values[parameter.id]);
    if (coerced !== undefined) resolved[parameter.id] = coerced;
  }
  return resolved;
}

/** The layer stack with every parameter value applied. Pure. */
export function applyParameters(
  template: GraphicTemplate,
  values: Readonly<Record<string, unknown>> | undefined,
): GraphicLayer[] {
  const resolved = resolveParamValues(template, values);
  const layers = new Map<string, GraphicLayer>(template.layers.map((layer) => [layer.id, layer]));
  for (const parameter of template.parameters) {
    const value = resolved[parameter.id];
    for (const target of parameter.targets) {
      const layer = layers.get(target.layerId);
      if (!layer) continue;
      layers.set(layer.id, applyProperty(layer, target.property, value));
    }
  }
  return template.layers.map((layer) => layers.get(layer.id) ?? layer);
}

function applyProperty(layer: GraphicLayer, property: string, value: GraphicParamValue): GraphicLayer {
  const num = typeof value === "number" ? value : undefined;
  const str = typeof value === "string" ? value : undefined;
  switch (property) {
    case "text":
      return layer.text && str !== undefined
        ? { ...layer, text: { ...layer.text, text: str, ...(layer.text.runs ? { runs: editRuns(layer.text.runs, str) } : {}) } } : layer;
    case "textColor":
      return layer.text && str !== undefined
        ? { ...layer, text: { ...layer.text, style: { ...layer.text.style, color: str } } } : layer;
    case "fontFamily":
      return layer.text && str !== undefined
        ? { ...layer, text: { ...layer.text, style: { ...layer.text.style, fontFamily: str } } } : layer;
    case "fontSize":
      return layer.text && num !== undefined
        ? { ...layer, text: { ...layer.text, style: { ...layer.text.style, fontSize: num } } } : layer;
    case "fontWeight":
      return layer.text && num !== undefined
        ? { ...layer, text: { ...layer.text, style: { ...layer.text.style, fontWeight: num as TextStyle["fontWeight"] } } } : layer;
    case "fill":
      return layer.shape && str !== undefined
        ? { ...layer, shape: { ...layer.shape, style: {
          ...layer.shape.style,
          fill: { ...(layer.shape.style.fill ?? DEFAULT_SHAPE_STYLE.fill), type: "solid", color: str, gradient: undefined },
        } } } : layer;
    case "strokeColor":
      return layer.shape && str !== undefined
        ? { ...layer, shape: { ...layer.shape, style: {
          ...layer.shape.style,
          stroke: { ...(layer.shape.style.stroke ?? DEFAULT_SHAPE_STYLE.stroke), color: str },
        } } } : layer;
    case "strokeWidth":
      return layer.shape && num !== undefined
        ? { ...layer, shape: { ...layer.shape, style: {
          ...layer.shape.style,
          stroke: { ...(layer.shape.style.stroke ?? DEFAULT_SHAPE_STYLE.stroke), width: num },
        } } } : layer;
    case "tint":
      return layer.svg && str !== undefined ? { ...layer, svg: { ...layer.svg, tintColor: str } } : layer;
    case "visible":
      return typeof value === "boolean" ? { ...layer, visible: value } : layer;
    case "x":
      return num !== undefined ? { ...layer, x: num } : layer;
    case "y":
      return num !== undefined ? { ...layer, y: num } : layer;
    case "position":
      return typeof value === "object" ? { ...layer, x: value.x, y: value.y } : layer;
    case "width":
      return num !== undefined ? { ...layer, width: Math.max(1, num) } : layer;
    case "height":
      return num !== undefined ? { ...layer, height: Math.max(1, num) } : layer;
    case "opacity":
      return num !== undefined ? { ...layer, opacity: Math.min(1, Math.max(0, num)) } : layer;
    case "rotation":
      return num !== undefined ? { ...layer, rotation: num } : layer;
    default:
      return layer;
  }
}

// ---------------------------------------------------------------------------
// Protected intro / outro
// ---------------------------------------------------------------------------

const motionSpan = (motion: GraphicMotion | undefined): number =>
  motion && motion.type !== "none" ? Math.max(0, motion.delay) + Math.max(0, motion.duration) : 0;

/** Intro / outro span of a layer's raw keyframes and text animation. */
function rawSpan(layer: GraphicLayer): { intro: number; outro: number } {
  let intro = 0;
  let outro = 0;
  for (const key of layer.keyframes ?? []) {
    if (key.anchor === "start") intro = Math.max(intro, key.time);
    else outro = Math.max(outro, -key.time);
  }
  const animation = layer.textAnimation;
  if (animation && animation.preset !== "none") {
    intro = Math.max(intro, animation.inDuration);
    outro = Math.max(outro, animation.outDuration);
  }
  return { intro, outro };
}

export interface ProtectedDurations {
  readonly intro: number;
  readonly outro: number;
  /** Shortest clip that still plays the whole intro and outro with a hold between. */
  readonly minDuration: number;
}

/**
 * The span of the clip the layers' own animation occupies at each end. Stretching
 * or trimming a graphic only ever changes the hold between them, so the in/out
 * animations are never squashed.
 */
export function protectedDurations(template: GraphicTemplate): ProtectedDurations {
  let intro = Math.max(0, template.introDuration ?? 0);
  let outro = Math.max(0, template.outroDuration ?? 0);
  for (const layer of template.layers) {
    const raw = rawSpan(layer);
    intro = Math.max(intro, motionSpan(layer.motionIn), raw.intro);
    outro = Math.max(outro, motionSpan(layer.motionOut), raw.outro);
  }
  return { intro, outro, minDuration: round(intro + outro + GRAPHIC_MIN_HOLD) };
}

export const clampGraphicDuration = (template: GraphicTemplate, duration: number): number =>
  Math.max(protectedDurations(template).minDuration, finite(duration, template.duration));

// ---------------------------------------------------------------------------
// Responsive layout (pins)
// ---------------------------------------------------------------------------

export interface LayerBox {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
}

/** Frame size in design units: the design width is fixed, the height follows the aspect. */
export function designFrame(frame: GraphicFrame): { width: number; height: number; scale: number } {
  const scale = frame.width / GRAPHIC_DESIGN_WIDTH;
  return { width: GRAPHIC_DESIGN_WIDTH, height: frame.height / scale, scale };
}

/** Layer boxes in design units for the given frame, with every pin resolved. */
export function resolveLayerBoxes(
  layers: readonly GraphicLayer[],
  frame: GraphicFrame,
): Map<string, LayerBox> {
  const design = designFrame(frame);
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const boxes = new Map<string, LayerBox>();
  const visiting = new Set<string>();
  const baseHeight = 1080;

  const resolve = (layer: GraphicLayer): LayerBox => {
    const cached = boxes.get(layer.id);
    if (cached) return cached;
    const w = Math.max(0, layer.width);
    const h = Math.max(0, layer.height);
    // Unpinned axes keep their offset from the frame centre.
    let cx = layer.x - GRAPHIC_DESIGN_WIDTH / 2 + design.width / 2;
    let cy = layer.y - baseHeight / 2 + design.height / 2;
    if (!visiting.has(layer.id)) {
      visiting.add(layer.id);
      const target = (pin: { to: string }, axis: "h" | "v") => {
        if (pin.to === "frame") return axis === "h" ? { start: 0, end: design.width } : { start: 0, end: design.height };
        const other = byId.get(pin.to);
        if (!other || other.id === layer.id) return axis === "h" ? { start: 0, end: design.width } : { start: 0, end: design.height };
        const box = resolve(other);
        return axis === "h"
          ? { start: box.cx - box.w / 2, end: box.cx + box.w / 2 }
          : { start: box.cy - box.h / 2, end: box.cy + box.h / 2 };
      };
      const horizontal = layer.pin?.horizontal;
      if (horizontal) {
        const span = target(horizontal, "h");
        if (horizontal.edge === "start") cx = span.start + horizontal.offset + w / 2;
        else if (horizontal.edge === "end") cx = span.end - horizontal.offset - w / 2;
        else cx = (span.start + span.end) / 2 + horizontal.offset;
      }
      const vertical = layer.pin?.vertical;
      if (vertical) {
        const span = target(vertical, "v");
        if (vertical.edge === "start") cy = span.start + vertical.offset + h / 2;
        else if (vertical.edge === "end") cy = span.end - vertical.offset - h / 2;
        else cy = (span.start + span.end) / 2 + vertical.offset;
      }
      visiting.delete(layer.id);
    }
    const box = { cx, cy, w, h };
    boxes.set(layer.id, box);
    return box;
  };
  for (const layer of layers) resolve(layer);
  return boxes;
}

// ---------------------------------------------------------------------------
// Expansion into ordinary clips
// ---------------------------------------------------------------------------

interface Rest {
  readonly x: number;
  readonly y: number;
  readonly sx: number;
  readonly sy: number;
  readonly opacity: number;
}

type KeyframeSpec = Omit<Keyframe, "id">;

function motionKeyframes(
  motion: GraphicMotion | undefined,
  direction: "in" | "out",
  rest: Rest,
  layerKind: GraphicLayer["kind"],
  design: { width: number; height: number },
  duration: number,
  boxW: number,
  boxH: number,
): KeyframeSpec[] {
  if (!motion || motion.type === "none" || motion.duration <= 0) return [];
  const easing = motion.easing ?? (direction === "in" ? "easeOutCubic" : "easeInCubic");
  const dist = motion.distance ?? 80;
  const dx = dist / design.width;
  const dy = dist / design.height;
  // Moves described as the hidden state; the rest state is the other end.
  const hidden: { x: number; y: number; sx: number; sy: number; opacity: number } = {
    x: rest.x, y: rest.y, sx: rest.sx, sy: rest.sy, opacity: rest.opacity,
  };
  const wipe = layerKind === "shape" || layerKind === "svg" || layerKind === "image";
  switch (motion.type) {
    case "fade":
      hidden.opacity = 0;
      break;
    case "slide-left": // enters travelling left (comes from the right)
      hidden.x = rest.x + dx;
      hidden.opacity = 0;
      break;
    case "slide-right":
      hidden.x = rest.x - dx;
      hidden.opacity = 0;
      break;
    case "slide-up":
      hidden.y = rest.y + dy;
      hidden.opacity = 0;
      break;
    case "slide-down":
      hidden.y = rest.y - dy;
      hidden.opacity = 0;
      break;
    case "scale":
      hidden.sx = rest.sx * 0.6;
      hidden.sy = rest.sy * 0.6;
      hidden.opacity = 0;
      break;
    case "wipe-right": // grows from the left edge
    case "wipe-left": {
      if (!wipe) { hidden.opacity = 0; break; }
      const half = (boxW / design.width) / 2;
      hidden.sx = 0;
      hidden.x = motion.type === "wipe-right" ? rest.x - half : rest.x + half;
      break;
    }
    case "wipe-down":
    case "wipe-up": {
      if (!wipe) { hidden.opacity = 0; break; }
      const half = (boxH / design.height) / 2;
      hidden.sy = 0;
      hidden.y = motion.type === "wipe-down" ? rest.y - half : rest.y + half;
      break;
    }
  }

  const start = direction === "in" ? Math.max(0, motion.delay) : duration - Math.max(0, motion.delay) - motion.duration;
  const end = start + motion.duration;
  const from = direction === "in" ? hidden : rest;
  const to = direction === "in" ? rest : hidden;
  const out: KeyframeSpec[] = [];
  const push = (property: string, a: number, b: number): void => {
    if (Math.abs(a - b) < 1e-9) return;
    // Hold the leading value up to the start so an intro delay / outro lead-in is exact.
    if (direction === "in" && start > 0) out.push({ time: 0, property, value: round(a), easing: "linear" });
    out.push({ time: round(start), property, value: round(a), easing });
    out.push({ time: round(end), property, value: round(b), easing: "linear" });
    if (direction === "out" && end < duration) out.push({ time: round(duration), property, value: round(b), easing: "linear" });
  };
  push("position.x", from.x, to.x);
  push("position.y", from.y, to.y);
  push("scale.x", from.sx, to.sx);
  push("scale.y", from.sy, to.sy);
  push("opacity", from.opacity, to.opacity);
  return out;
}

/** Merge intro and outro keyframes per property into one ordered, valid track. */
function mergeKeyframes(clipId: string, intro: KeyframeSpec[], outro: KeyframeSpec[], rest: Rest): Keyframe[] {
  const restValue: Record<string, number> = {
    "position.x": rest.x, "position.y": rest.y, "scale.x": rest.sx, "scale.y": rest.sy, opacity: rest.opacity,
  };
  const properties = new Set([...intro, ...outro].map((spec) => spec.property));
  const merged: Keyframe[] = [];
  let n = 0;
  for (const property of [...properties].sort()) {
    const ins = intro.filter((spec) => spec.property === property);
    const outs = outro.filter((spec) => spec.property === property);
    const track: KeyframeSpec[] = [...ins];
    // An outro on a property the intro does not touch needs an explicit rest key before it.
    if (ins.length === 0 && outs.length > 0) track.push({ time: 0, property, value: restValue[property], easing: "linear" });
    // An intro on a property the outro does not touch holds its rest value to the end.
    track.push(...outs);
    track.sort((a, b) => a.time - b.time);
    for (const spec of track) merged.push({ id: `${clipId}__kf${n++}`, ...spec });
  }
  return merged;
}

/**
 * Layer keyframes for a clip of `duration`: the motion presets, except on properties the
 * layer animates with raw keyframes (those win), plus the raw keyframes themselves.
 */
function layerKeyframes(
  clipId: string,
  layer: GraphicLayer,
  kind: GraphicLayer["kind"],
  rest: Rest,
  design: { width: number; height: number },
  duration: number,
  boxW: number,
  boxH: number,
): Keyframe[] {
  const raw = (layer.keyframes ?? []).filter((key) => Number.isFinite(key.time) && Number.isFinite(key.value));
  const rawProps = new Set(raw.map((key) => key.property));
  const intro = motionKeyframes(layer.motionIn, "in", rest, kind, design, duration, boxW, boxH).filter((spec) => !rawProps.has(spec.property as never));
  const outro = motionKeyframes(layer.motionOut, "out", rest, kind, design, duration, boxW, boxH).filter((spec) => !rawProps.has(spec.property as never));
  const merged = mergeKeyframes(clipId, intro, outro, rest);
  if (raw.length === 0) return merged;
  const timed = raw
    .map((key) => ({
      ...key,
      at: Math.min(duration, Math.max(0, key.anchor === "start" ? key.time : duration + key.time)),
    }))
    .sort((a, b) => a.at - b.at);
  return [
    ...merged,
    ...timed.map((key, index): Keyframe => ({
      id: `${clipId}__rk${index}`,
      time: round(key.at),
      property: key.property,
      value: round(key.value),
      easing: key.easing,
    })),
  ];
}

const svgDataUrl = (src: string): string => src;

function imageSvg(src: string, aspect: number): { svg: string; width: number; height: number } {
  const height = 1000;
  const width = Math.max(1, Math.round(height * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1)));
  const safe = svgDataUrl(src).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><image href="${safe}" xlink:href="${safe}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/></svg>`,
    width,
    height,
  };
}

function buildTransform(rest: Rest, rotation: number): Transform {
  return {
    position: { x: round(rest.x), y: round(rest.y) },
    scale: { x: round(rest.sx), y: round(rest.sy) },
    rotation,
    anchor: { x: 0.5, y: 0.5 },
    opacity: round(rest.opacity),
  };
}

/** Layer properties a keyframed (master) parameter can animate. */
const KEYFRAMABLE_PROPERTIES = new Set(["opacity", "rotation", "x", "y"]);

/** Number / slider parameters whose every target is a property that maps onto a clip keyframe. */
export function isKeyframableParameter(parameter: GraphicParameter): boolean {
  return (
    (parameter.type === "number" || parameter.type === "slider") &&
    parameter.targets.length > 0 &&
    parameter.targets.every((target) => KEYFRAMABLE_PROPERTIES.has(target.property))
  );
}

/**
 * Add the instance's parameter keyframes to the layers they target as raw layer
 * keyframes (which replace the motion preset on that property), so the animated
 * value reaches the clips exactly like a hand-keyframed one. Position values are
 * design pixels: a keyframe moves the layer by its distance from the static value.
 */
function injectParamKeyframes(
  template: GraphicTemplate,
  layers: GraphicLayer[],
  instance: GraphicInstance,
  frame: GraphicFrame,
): GraphicLayer[] {
  const keyed = instance.paramKeyframes;
  if (!keyed) return layers;
  const design = designFrame(frame);
  const extra = new Map<string, GraphicLayerKeyframe[]>();
  let boxes: Map<string, LayerBox> | undefined;
  for (const parameter of template.parameters) {
    const keys = keyed[parameter.id];
    if (!keys?.length || !isKeyframableParameter(parameter)) continue;
    const sorted = [...keys]
      .filter((key) => Number.isFinite(key.time) && Number.isFinite(key.value))
      .sort((a, b) => a.time - b.time);
    for (const target of parameter.targets) {
      const layer = layers.find((item) => item.id === target.layerId);
      if (!layer) continue;
      const list = extra.get(layer.id) ?? [];
      for (const key of sorted) {
        const time = Math.max(0, key.time);
        if (target.property === "opacity") {
          list.push({ time, anchor: "start", property: "opacity", value: Math.min(1, Math.max(0, key.value)), easing: key.easing });
        } else if (target.property === "rotation") {
          list.push({ time, anchor: "start", property: "rotation", value: key.value, easing: key.easing });
        } else {
          boxes ??= resolveLayerBoxes(layers, frame);
          const box = boxes.get(layer.id);
          if (!box) continue;
          const horizontal = target.property === "x";
          const rest = horizontal ? layer.x : layer.y;
          const align = layer.text?.style.textAlign;
          const alignShift = horizontal && layer.kind === "text" ? (align === "left" ? -box.w / 2 : align === "right" ? box.w / 2 : 0) : 0;
          const centre = (horizontal ? box.cx : box.cy) + alignShift + (key.value - rest);
          list.push({
            time,
            anchor: "start",
            property: horizontal ? "position.x" : "position.y",
            value: centre / (horizontal ? design.width : design.height),
            easing: key.easing,
          });
        }
      }
      extra.set(layer.id, list);
    }
  }
  if (extra.size === 0) return layers;
  return layers.map((layer) => {
    const more = extra.get(layer.id);
    if (!more?.length) return layer;
    // A keyframed parameter owns its property: the layer's own keys on it step aside.
    const owned = new Set(more.map((key) => key.property));
    return { ...layer, keyframes: [...(layer.keyframes ?? []).filter((key) => !owned.has(key.property)), ...more] };
  });
}

/**
 * Expand an instance into ordinary overlay clips: deterministic ids, one per
 * visible layer, spanning exactly the instance. Pure and total: equal inputs give
 * equal clips (the render cache fingerprints them like any hand-made clip).
 */
export function expandGraphicInstance(instance: GraphicInstance, frame: GraphicFrame): ExpandedGraphic {
  // Rendered (Render and Replace): an ordinary media clip stands in for the live layers.
  if (instance.bake) return { textClips: [], shapeClips: [], svgClips: [] };
  const layers = injectParamKeyframes(
    instance.template,
    applyParameters(instance.template, instance.values),
    instance,
    frame,
  );
  const design = designFrame(frame);
  const boxes = resolveLayerBoxes(layers, frame);
  const textClips: TextClip[] = [];
  const shapeClips: ShapeClip[] = [];
  const svgClips: SVGClip[] = [];
  const duration = Math.max(0.01, instance.duration);
  const shapeSize = Math.min(frame.width, frame.height) * 0.15;

  for (const layer of layers) {
    if (!layer.visible) continue;
    const box = boxes.get(layer.id);
    if (!box) continue;
    const id = graphicMemberId(instance.id, layer.id);
    const metadata = { [GRAPHIC_LAYER_MEMBER_KEY]: instance.id, [GRAPHIC_LAYER_ID_KEY]: layer.id };
    const base = {
      id,
      trackId: instance.trackId,
      startTime: instance.startTime,
      duration,
      metadata,
    };
    const cxN = box.cx / design.width;
    const cyN = box.cy / design.height;
    const opacity = Math.min(1, Math.max(0, layer.opacity));

    if (layer.kind === "text" && layer.text) {
      const style: TextStyle = {
        ...DEFAULT_TEXT_STYLE,
        strokeColor: undefined,
        strokeWidth: undefined,
        ...layer.text.style,
        fontSize: round(finite(layer.text.style.fontSize ?? DEFAULT_TEXT_STYLE.fontSize, 48) * design.scale),
        // Every length in the style is in design pixels: scale with the frame.
        ...(layer.text.style.strokeWidth ? { strokeWidth: round(layer.text.style.strokeWidth * design.scale) } : {}),
        ...(layer.text.style.letterSpacing ? { letterSpacing: round(layer.text.style.letterSpacing * design.scale) } : {}),
        ...(layer.text.style.shadowBlur ? { shadowBlur: round(layer.text.style.shadowBlur * design.scale) } : {}),
        ...(layer.text.style.shadowOffsetX ? { shadowOffsetX: round(layer.text.style.shadowOffsetX * design.scale) } : {}),
        ...(layer.text.style.shadowOffsetY ? { shadowOffsetY: round(layer.text.style.shadowOffsetY * design.scale) } : {}),
        verticalAlign: "middle",
      } as TextStyle;
      const align = style.textAlign === "left" || style.textAlign === "right" ? style.textAlign : "center";
      const textCx = align === "left" ? box.cx - box.w / 2 : align === "right" ? box.cx + box.w / 2 : box.cx;
      const rest: Rest = { x: textCx / design.width, y: cyN, sx: 1, sy: 1, opacity };
      const animation = layer.textAnimation;
      textClips.push({
        ...base,
        text: layer.text.text,
        style,
        ...(layer.text.runs && hasRunOverrides(layer.text.runs)
          ? { runs: scaleRuns(runsForText(layer.text.text, layer.text.runs), design.scale) }
          : {}),
        transform: buildTransform(rest, layer.rotation),
        keyframes: layerKeyframes(id, layer, "text", rest, design, duration, box.w, box.h),
        ...(animation && animation.preset !== "none"
          ? {
            animation: {
              preset: animation.preset,
              params: animation.params ?? {},
              inDuration: animation.inDuration,
              outDuration: animation.outDuration,
              ...(animation.stagger !== undefined ? { stagger: animation.stagger } : {}),
              ...(animation.unit ? { unit: animation.unit } : {}),
            },
          }
          : {}),
      });
      continue;
    }

    if (layer.kind === "shape" && layer.shape) {
      const style: ShapeStyle = {
        ...DEFAULT_SHAPE_STYLE,
        ...layer.shape.style,
        fill: { ...DEFAULT_SHAPE_STYLE.fill, ...layer.shape.style.fill },
        stroke: { ...DEFAULT_SHAPE_STYLE.stroke, width: 0, ...layer.shape.style.stroke },
      };
      const rest: Rest = {
        x: cxN, y: cyN,
        sx: shapeSize > 0 ? (box.w * design.scale) / shapeSize : 1,
        sy: shapeSize > 0 ? (box.h * design.scale) / shapeSize : 1,
        opacity,
      };
      shapeClips.push({
        ...base,
        type: "shape",
        shapeType: layer.shape.shapeType,
        style,
        transform: buildTransform(rest, layer.rotation),
        keyframes: layerKeyframes(id, layer, "shape", rest, design, duration, box.w, box.h),
      });
      continue;
    }

    if ((layer.kind === "svg" && layer.svg) || (layer.kind === "image" && layer.image)) {
      let svgContent: string;
      let vbW: number;
      let vbH: number;
      let tint: string | undefined;
      if (layer.kind === "svg" && layer.svg) {
        svgContent = layer.svg.svgContent;
        vbW = Math.max(1, layer.svg.viewBoxWidth);
        vbH = Math.max(1, layer.svg.viewBoxHeight);
        tint = layer.svg.tintColor;
      } else if (layer.image) {
        const wrapped = imageSvg(layer.image.src, layer.image.aspect);
        svgContent = wrapped.svg;
        vbW = wrapped.width;
        vbH = wrapped.height;
      } else continue;
      const aspect = vbW / vbH;
      const baseW = aspect > 1 ? frame.width : frame.height * aspect;
      const baseH = aspect > 1 ? frame.width / aspect : frame.height;
      const rest: Rest = {
        x: cxN, y: cyN,
        sx: (box.w * design.scale) / baseW,
        sy: (box.h * design.scale) / baseH,
        opacity,
      };
      svgClips.push({
        ...base,
        type: "svg",
        svgContent,
        viewBox: { minX: 0, minY: 0, width: vbW, height: vbH },
        preserveAspectRatio: "xMidYMid",
        ...(tint ? { colorStyle: { colorMode: "replace" as const, tintColor: tint, tintOpacity: 1 } } : {}),
        transform: buildTransform(rest, layer.rotation),
        keyframes: layerKeyframes(id, layer, layer.kind, rest, design, duration, box.w, box.h),
      });
    }
  }
  return { textClips, shapeClips, svgClips };
}
