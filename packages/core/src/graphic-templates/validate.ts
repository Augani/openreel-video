import type { EasingType } from "../types/timeline";
import { EASING_TYPES } from "../types/timeline";
import { SHAPE_TYPES } from "../graphics/types";
import type { ShapeStyle, ShapeType } from "../graphics/types";
import type { TextAnimationPreset, TextStyle } from "../text/types";
import {
  GRAPHIC_TEMPLATE_SCHEMA_VERSION,
  type GraphicAxisPin,
  type GraphicKeyframeProperty,
  type GraphicLayer,
  type GraphicLayerKeyframe,
  type GraphicTextAnimation,
  type GraphicLayerKind,
  type GraphicMotion,
  type GraphicMotionType,
  type GraphicParamProperty,
  type GraphicParamType,
  type GraphicParamValue,
  type GraphicParameter,
  type GraphicTemplate,
  type GraphicTemplateCategory,
} from "./types";

/** Hard limits applied to every template, built-in or imported. */
export const GRAPHIC_LIMITS = {
  maxLayers: 64,
  maxParameters: 64,
  maxTargetsPerParameter: 32,
  maxStringLength: 4000,
  maxNameLength: 120,
  maxSvgBytes: 200_000,
  maxImageBytes: 2_000_000,
  maxTotalEmbeddedBytes: 8_000_000,
  maxFileBytes: 12_000_000,
  maxDuration: 3600,
  maxCoordinate: 20_000,
} as const;

export type GraphicValidation =
  | { readonly ok: true; readonly template: GraphicTemplate }
  | { readonly ok: false; readonly errors: string[] };

const CATEGORIES: readonly GraphicTemplateCategory[] = ["lower-third", "title", "callout", "end-card", "custom"];
const KINDS: readonly GraphicLayerKind[] = ["text", "shape", "svg", "image"];
const MOTIONS: readonly GraphicMotionType[] = [
  "none", "fade", "slide-left", "slide-right", "slide-up", "slide-down", "scale",
  "wipe-right", "wipe-left", "wipe-up", "wipe-down",
];
const PARAM_TYPES: readonly GraphicParamType[] = ["text", "color", "font", "number", "slider", "checkbox", "position"];
const PARAM_PROPS: readonly GraphicParamProperty[] = [
  "text", "textColor", "fontFamily", "fontSize", "fontWeight", "fill", "strokeColor", "strokeWidth",
  "tint", "visible", "x", "y", "position", "width", "height", "opacity", "rotation",
];
/** Which parameter types may drive which property. */
const PROPERTY_TYPES: Record<GraphicParamProperty, readonly GraphicParamType[]> = {
  text: ["text"],
  textColor: ["color"],
  fontFamily: ["font"],
  fontSize: ["number", "slider"],
  fontWeight: ["number", "slider"],
  fill: ["color"],
  strokeColor: ["color"],
  strokeWidth: ["number", "slider"],
  tint: ["color"],
  visible: ["checkbox"],
  x: ["number", "slider"],
  y: ["number", "slider"],
  position: ["position"],
  width: ["number", "slider"],
  height: ["number", "slider"],
  opacity: ["number", "slider"],
  rotation: ["number", "slider"],
};
const KEYFRAME_PROPERTIES: readonly GraphicKeyframeProperty[] = ["position.x", "position.y", "scale.x", "scale.y", "rotation", "opacity"];
const TEXT_PRESETS: readonly TextAnimationPreset[] = [
  "none", "typewriter", "fade", "slide-left", "slide-right", "slide-up", "slide-down", "scale", "blur", "bounce",
  "rotate", "wave", "shake", "pop", "glitch", "split", "flip", "word-by-word", "rainbow", "rise", "drop", "elastic",
  "swing", "zoom-blur", "cascade",
];
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/]+\))$/i;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const FONT_WEIGHTS = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900, "normal", "bold"]);
const TEXT_ALIGNS = new Set(["left", "center", "right", "justify"]);
const IMAGE_DATA = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

class Errors {
  readonly list: string[] = [];
  add(path: string, message: string): void {
    if (this.list.length < 25) this.list.push(`${path}: ${message}`);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Own enumerable keys, rejecting prototype-pollution vectors anywhere they appear. */
function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 12 || typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKey(item, depth + 1));
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKey((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/**
 * Reject anything in an SVG that can run code or reach the network. Embedded
 * images must be data: URLs. (The renderer rasterizes SVG through an <img>, which
 * already blocks scripts, but a template is shared between people: defend anyway.)
 */
export function svgIsSafe(svg: string): boolean {
  if (!/<svg[\s>]/i.test(svg)) return false;
  if (/<\s*(script|foreignObject|iframe|object|embed|style|link|audio|video|animate|set)\b/i.test(svg)) return false;
  if (/\son[a-z]+\s*=/i.test(svg)) return false;
  if (/javascript:/i.test(svg)) return false;
  if (/<!ENTITY|<!DOCTYPE/i.test(svg)) return false;
  for (const match of svg.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) {
    const target = match[1].trim();
    if (!target.startsWith("#") && !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(target)) return false;
  }
  if (/url\(\s*["']?(?!#)/i.test(svg)) return false;
  return true;
}

function str(value: unknown, path: string, errors: Errors, max: number, fallback?: string): string {
  if (typeof value !== "string") {
    if (fallback !== undefined && value === undefined) return fallback;
    errors.add(path, "must be a string");
    return fallback ?? "";
  }
  if (value.length > max) {
    errors.add(path, `is longer than ${max} characters`);
    return value.slice(0, max);
  }
  return value;
}

function num(value: unknown, path: string, errors: Errors, min: number, max: number, fallback?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    if (fallback !== undefined && value === undefined) return fallback;
    errors.add(path, "must be a finite number");
    return fallback ?? 0;
  }
  if (value < min || value > max) {
    errors.add(path, `must be between ${min} and ${max}`);
    return Math.min(max, Math.max(min, value));
  }
  return value;
}

function id(value: unknown, path: string, errors: Errors): string {
  if (typeof value !== "string" || !ID.test(value)) {
    errors.add(path, "must be 1-80 letters, digits, '_', '-', '.' or ':'");
    return "invalid";
  }
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, errors: Errors, allowed: readonly T[], fallback: T): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  errors.add(path, `must be one of ${allowed.join(", ")}`);
  return fallback;
}

function color(value: unknown, path: string, errors: Errors): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && COLOR.test(value.trim())) return value.trim();
  errors.add(path, "must be a color (#hex, rgb(), hsl())");
  return undefined;
}

function motion(value: unknown, path: string, errors: Errors): GraphicMotion | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.add(path, "must be an object");
    return undefined;
  }
  const easing = value.easing;
  return {
    type: oneOf(value.type, `${path}.type`, errors, MOTIONS, "none"),
    delay: num(value.delay, `${path}.delay`, errors, 0, 60, 0),
    duration: num(value.duration, `${path}.duration`, errors, 0, 60),
    ...(value.distance !== undefined ? { distance: num(value.distance, `${path}.distance`, errors, 0, GRAPHIC_LIMITS.maxCoordinate) } : {}),
    ...(easing !== undefined
      ? { easing: oneOf(easing, `${path}.easing`, errors, EASING_TYPES as readonly EasingType[], "linear") }
      : {}),
  };
}

function layerKeyframes(value: unknown, path: string, errors: Errors): GraphicLayerKeyframe[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 128) {
    errors.add(path, "must be a list of at most 128 keyframes");
    return undefined;
  }
  return value.flatMap((entry, index): GraphicLayerKeyframe[] => {
    const kpath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      errors.add(kpath, "must be an object");
      return [];
    }
    const anchor = oneOf(entry.anchor, `${kpath}.anchor`, errors, ["start", "end"] as const, "start");
    return [{
      time: num(entry.time, `${kpath}.time`, errors, anchor === "end" ? -3600 : 0, anchor === "end" ? 0 : 3600),
      anchor,
      property: oneOf(entry.property, `${kpath}.property`, errors, KEYFRAME_PROPERTIES, "opacity"),
      value: num(entry.value, `${kpath}.value`, errors, -1e6, 1e6),
      easing: oneOf(entry.easing ?? "linear", `${kpath}.easing`, errors, EASING_TYPES as readonly EasingType[], "linear"),
    }];
  });
}

function textAnimation(value: unknown, path: string, errors: Errors): GraphicTextAnimation | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.add(path, "must be an object");
    return undefined;
  }
  const params: Record<string, unknown> = {};
  if (isRecord(value.params)) {
    for (const [key, entry] of Object.entries(value.params)) {
      if (/^[A-Za-z]{1,32}$/.test(key) && typeof entry === "number" && Number.isFinite(entry)) params[key] = entry;
    }
  }
  return {
    preset: oneOf(value.preset, `${path}.preset`, errors, TEXT_PRESETS, "none"),
    inDuration: num(value.inDuration, `${path}.inDuration`, errors, 0, 60, 0),
    outDuration: num(value.outDuration, `${path}.outDuration`, errors, 0, 60, 0),
    ...(value.stagger !== undefined ? { stagger: num(value.stagger, `${path}.stagger`, errors, 0, 5) } : {}),
    ...(value.unit !== undefined ? { unit: oneOf(value.unit, `${path}.unit`, errors, ["character", "word", "line"] as const, "character") } : {}),
    ...(Object.keys(params).length ? { params: params as GraphicTextAnimation["params"] } : {}),
  };
}

function pin(value: unknown, path: string, errors: Errors, layerIds: ReadonlySet<string>): GraphicAxisPin | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.add(path, "must be an object");
    return undefined;
  }
  const to = value.to === "frame" ? "frame" : typeof value.to === "string" && layerIds.has(value.to) ? value.to : undefined;
  if (to === undefined) {
    errors.add(`${path}.to`, 'must be "frame" or the id of a layer in this template');
    return undefined;
  }
  return {
    edge: oneOf(value.edge, `${path}.edge`, errors, ["start", "end", "center"] as const, "start"),
    to,
    offset: num(value.offset, `${path}.offset`, errors, -GRAPHIC_LIMITS.maxCoordinate, GRAPHIC_LIMITS.maxCoordinate, 0),
  };
}

function textStyle(value: unknown, path: string, errors: Errors): Partial<TextStyle> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    errors.add(path, "must be an object");
    return {};
  }
  const out: Record<string, unknown> = {};
  if (value.fontFamily !== undefined) out.fontFamily = str(value.fontFamily, `${path}.fontFamily`, errors, 100);
  if (value.fontSize !== undefined) out.fontSize = num(value.fontSize, `${path}.fontSize`, errors, 1, 2000);
  if (value.fontWeight !== undefined) {
    if (FONT_WEIGHTS.has(value.fontWeight as number | string)) out.fontWeight = value.fontWeight;
    else errors.add(`${path}.fontWeight`, "is not a valid weight");
  }
  if (value.fontStyle !== undefined) out.fontStyle = oneOf(value.fontStyle, `${path}.fontStyle`, errors, ["normal", "italic"] as const, "normal");
  for (const key of ["color", "backgroundColor", "strokeColor", "shadowColor"] as const) {
    if (value[key] !== undefined) out[key] = color(value[key], `${path}.${key}`, errors);
  }
  for (const [key, min, max] of [
    ["strokeWidth", 0, 100], ["shadowBlur", 0, 200], ["shadowOffsetX", -500, 500], ["shadowOffsetY", -500, 500],
    ["lineHeight", 0.2, 5], ["letterSpacing", -50, 200],
  ] as const) {
    if (value[key] !== undefined) out[key] = num(value[key], `${path}.${key}`, errors, min, max);
  }
  if (value.textAlign !== undefined) {
    if (typeof value.textAlign === "string" && TEXT_ALIGNS.has(value.textAlign)) out.textAlign = value.textAlign;
    else errors.add(`${path}.textAlign`, "is not a valid alignment");
  }
  return out as Partial<TextStyle>;
}

function fillLike(value: unknown, path: string, errors: Errors): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.add(path, "must be an object");
    return undefined;
  }
  const out: Record<string, unknown> = {};
  if (value.type !== undefined) out.type = oneOf(value.type, `${path}.type`, errors, ["solid", "gradient", "none"] as const, "solid");
  if (value.color !== undefined) out.color = color(value.color, `${path}.color`, errors);
  if (value.opacity !== undefined) out.opacity = num(value.opacity, `${path}.opacity`, errors, 0, 1);
  if (value.width !== undefined) out.width = num(value.width, `${path}.width`, errors, 0, 200);
  if (value.gradient !== undefined) {
    const gradient = value.gradient;
    if (!isRecord(gradient) || !Array.isArray(gradient.stops) || gradient.stops.length < 2 || gradient.stops.length > 12) {
      errors.add(`${path}.gradient`, "needs 2-12 stops");
    } else {
      out.gradient = {
        type: oneOf(gradient.type, `${path}.gradient.type`, errors, ["linear", "radial"] as const, "linear"),
        ...(gradient.angle !== undefined ? { angle: num(gradient.angle, `${path}.gradient.angle`, errors, -360, 360) } : {}),
        stops: gradient.stops.map((stop, index) => {
          const record = isRecord(stop) ? stop : {};
          return {
            offset: num(record.offset, `${path}.gradient.stops[${index}].offset`, errors, 0, 1),
            color: color(record.color, `${path}.gradient.stops[${index}].color`, errors) ?? "#000000",
            ...(record.opacity !== undefined ? { opacity: num(record.opacity, `${path}.gradient.stops[${index}].opacity`, errors, 0, 1) } : {}),
          };
        }),
      };
    }
  }
  return out;
}

function shapeStyle(value: unknown, path: string, errors: Errors): Partial<ShapeStyle> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    errors.add(path, "must be an object");
    return {};
  }
  const out: Record<string, unknown> = {};
  const fill = fillLike(value.fill, `${path}.fill`, errors);
  if (fill) out.fill = fill;
  const stroke = fillLike(value.stroke, `${path}.stroke`, errors);
  if (stroke) out.stroke = stroke;
  if (value.cornerRadius !== undefined) out.cornerRadius = num(value.cornerRadius, `${path}.cornerRadius`, errors, 0, 2000);
  if (value.points !== undefined) out.points = num(value.points, `${path}.points`, errors, 3, 24);
  if (value.innerRadius !== undefined) out.innerRadius = num(value.innerRadius, `${path}.innerRadius`, errors, 0, 1);
  if (value.shadow !== undefined) {
    const shadow = value.shadow;
    if (!isRecord(shadow)) errors.add(`${path}.shadow`, "must be an object");
    else {
      out.shadow = {
        color: color(shadow.color, `${path}.shadow.color`, errors) ?? "#000000",
        blur: num(shadow.blur, `${path}.shadow.blur`, errors, 0, 500),
        offsetX: num(shadow.offsetX, `${path}.shadow.offsetX`, errors, -1000, 1000, 0),
        offsetY: num(shadow.offsetY, `${path}.shadow.offsetY`, errors, -1000, 1000, 0),
      };
    }
  }
  return out as Partial<ShapeStyle>;
}

interface Budget {
  embedded: number;
}

function layer(raw: unknown, index: number, errors: Errors, layerIds: ReadonlySet<string>, budget: Budget): GraphicLayer | null {
  const path = `layers[${index}]`;
  if (!isRecord(raw)) {
    errors.add(path, "must be an object");
    return null;
  }
  const kind = oneOf(raw.kind, `${path}.kind`, errors, KINDS, "shape");
  const coordinate = GRAPHIC_LIMITS.maxCoordinate;
  const result: {
    -readonly [K in keyof GraphicLayer]: GraphicLayer[K];
  } = {
    id: id(raw.id, `${path}.id`, errors),
    name: str(raw.name, `${path}.name`, errors, GRAPHIC_LIMITS.maxNameLength, ""),
    kind,
    visible: typeof raw.visible === "boolean" ? raw.visible : true,
    x: num(raw.x, `${path}.x`, errors, -coordinate, coordinate, 960),
    y: num(raw.y, `${path}.y`, errors, -coordinate, coordinate, 540),
    width: num(raw.width, `${path}.width`, errors, 0, coordinate, 100),
    height: num(raw.height, `${path}.height`, errors, 0, coordinate, 100),
    rotation: num(raw.rotation, `${path}.rotation`, errors, -3600, 3600, 0),
    opacity: num(raw.opacity, `${path}.opacity`, errors, 0, 1, 1),
  };
  if (raw.pin !== undefined) {
    if (!isRecord(raw.pin)) errors.add(`${path}.pin`, "must be an object");
    else {
      const horizontal = pin(raw.pin.horizontal, `${path}.pin.horizontal`, errors, layerIds);
      const vertical = pin(raw.pin.vertical, `${path}.pin.vertical`, errors, layerIds);
      if (horizontal || vertical) result.pin = { ...(horizontal ? { horizontal } : {}), ...(vertical ? { vertical } : {}) };
    }
  }
  const motionIn = motion(raw.motionIn, `${path}.motionIn`, errors);
  const motionOut = motion(raw.motionOut, `${path}.motionOut`, errors);
  if (motionIn) result.motionIn = motionIn;
  if (motionOut) result.motionOut = motionOut;
  const keyframes = layerKeyframes(raw.keyframes, `${path}.keyframes`, errors);
  if (keyframes?.length) result.keyframes = keyframes;
  const animation = textAnimation(raw.textAnimation, `${path}.textAnimation`, errors);
  if (animation) result.textAnimation = animation;

  if (kind === "text") {
    if (!isRecord(raw.text)) errors.add(`${path}.text`, "text layers need a text object");
    else result.text = {
      text: str(raw.text.text, `${path}.text.text`, errors, GRAPHIC_LIMITS.maxStringLength, ""),
      style: textStyle(raw.text.style, `${path}.text.style`, errors),
    };
  } else if (kind === "shape") {
    if (!isRecord(raw.shape)) errors.add(`${path}.shape`, "shape layers need a shape object");
    else {
      const shapeType = oneOf(raw.shape.shapeType, `${path}.shape.shapeType`, errors,
        SHAPE_TYPES.filter((type) => !type.startsWith("mesh-")) as readonly ShapeType[], "rectangle");
      result.shape = { shapeType, style: shapeStyle(raw.shape.style, `${path}.shape.style`, errors) };
    }
  } else if (kind === "svg") {
    if (!isRecord(raw.svg)) errors.add(`${path}.svg`, "svg layers need an svg object");
    else {
      const svgContent = str(raw.svg.svgContent, `${path}.svg.svgContent`, errors, GRAPHIC_LIMITS.maxSvgBytes);
      budget.embedded += svgContent.length;
      if (svgContent && !svgIsSafe(svgContent)) errors.add(`${path}.svg.svgContent`, "contains scripts, external references or other unsafe content");
      const tint = color(raw.svg.tintColor, `${path}.svg.tintColor`, errors);
      result.svg = {
        svgContent,
        viewBoxWidth: num(raw.svg.viewBoxWidth, `${path}.svg.viewBoxWidth`, errors, 1, 100000),
        viewBoxHeight: num(raw.svg.viewBoxHeight, `${path}.svg.viewBoxHeight`, errors, 1, 100000),
        ...(tint ? { tintColor: tint } : {}),
      };
    }
  } else if (kind === "image") {
    if (!isRecord(raw.image)) errors.add(`${path}.image`, "image layers need an image object");
    else {
      const src = str(raw.image.src, `${path}.image.src`, errors, GRAPHIC_LIMITS.maxImageBytes * 1.4);
      budget.embedded += src.length;
      if (src.length > GRAPHIC_LIMITS.maxImageBytes * 1.4) errors.add(`${path}.image.src`, "is too large");
      if (!IMAGE_DATA.test(src)) errors.add(`${path}.image.src`, "must be an embedded png, jpeg, webp or gif data URL");
      result.image = { src, aspect: num(raw.image.aspect, `${path}.image.aspect`, errors, 0.01, 100, 1) };
    }
  }
  return result;
}

function parameter(raw: unknown, index: number, errors: Errors, layers: ReadonlyMap<string, GraphicLayer>): GraphicParameter | null {
  const path = `parameters[${index}]`;
  if (!isRecord(raw)) {
    errors.add(path, "must be an object");
    return null;
  }
  const type = oneOf(raw.type, `${path}.type`, errors, PARAM_TYPES, "text");
  const min = raw.min !== undefined ? num(raw.min, `${path}.min`, errors, -1e6, 1e6) : undefined;
  const max = raw.max !== undefined ? num(raw.max, `${path}.max`, errors, -1e6, 1e6) : undefined;
  if (min !== undefined && max !== undefined && min > max) errors.add(path, "min is greater than max");
  let defaultValue: GraphicParamValue = "";
  const dv = raw.defaultValue;
  switch (type) {
    case "text": defaultValue = str(dv, `${path}.defaultValue`, errors, GRAPHIC_LIMITS.maxStringLength, ""); break;
    case "font": defaultValue = str(dv, `${path}.defaultValue`, errors, 100, "Inter"); break;
    case "color": defaultValue = color(dv, `${path}.defaultValue`, errors) ?? "#ffffff"; break;
    case "checkbox":
      if (typeof dv !== "boolean") errors.add(`${path}.defaultValue`, "must be true or false");
      defaultValue = dv === true;
      break;
    case "number":
    case "slider":
      defaultValue = num(dv, `${path}.defaultValue`, errors, min ?? -1e6, max ?? 1e6);
      break;
    case "position": {
      const point = isRecord(dv) ? dv : {};
      defaultValue = {
        x: num(point.x, `${path}.defaultValue.x`, errors, -GRAPHIC_LIMITS.maxCoordinate, GRAPHIC_LIMITS.maxCoordinate),
        y: num(point.y, `${path}.defaultValue.y`, errors, -GRAPHIC_LIMITS.maxCoordinate, GRAPHIC_LIMITS.maxCoordinate),
      };
      break;
    }
  }
  const options = Array.isArray(raw.options)
    ? raw.options.slice(0, 64).map((option, i) => str(option, `${path}.options[${i}]`, errors, 100))
    : undefined;
  const targetsRaw = Array.isArray(raw.targets) ? raw.targets : [];
  if (!Array.isArray(raw.targets) || targetsRaw.length === 0) errors.add(`${path}.targets`, "needs at least one target");
  if (targetsRaw.length > GRAPHIC_LIMITS.maxTargetsPerParameter) errors.add(`${path}.targets`, "has too many targets");
  const targets = targetsRaw.slice(0, GRAPHIC_LIMITS.maxTargetsPerParameter).flatMap((entry, i) => {
    const tpath = `${path}.targets[${i}]`;
    if (!isRecord(entry)) {
      errors.add(tpath, "must be an object");
      return [];
    }
    const layerId = typeof entry.layerId === "string" ? entry.layerId : "";
    const property = oneOf(entry.property, `${tpath}.property`, errors, PARAM_PROPS, "text");
    const target = layers.get(layerId);
    if (!target) {
      errors.add(`${tpath}.layerId`, "does not match a layer");
      return [];
    }
    if (!PROPERTY_TYPES[property].includes(type)) {
      errors.add(tpath, `${property} cannot be driven by a ${type} control`);
      return [];
    }
    const needsText = property === "text" || property === "textColor" || property === "fontFamily" || property === "fontSize" || property === "fontWeight";
    const needsShape = property === "fill" || property === "strokeColor" || property === "strokeWidth";
    if ((needsText && target.kind !== "text") || (needsShape && target.kind !== "shape") || (property === "tint" && target.kind !== "svg")) {
      errors.add(tpath, `${property} does not apply to a ${target.kind} layer`);
      return [];
    }
    return [{ layerId, property }];
  });
  const group = raw.group !== undefined ? str(raw.group, `${path}.group`, errors, GRAPHIC_LIMITS.maxNameLength) : undefined;
  return {
    id: id(raw.id, `${path}.id`, errors),
    label: str(raw.label, `${path}.label`, errors, GRAPHIC_LIMITS.maxNameLength),
    ...(group ? { group } : {}),
    type,
    defaultValue,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(raw.step !== undefined ? { step: num(raw.step, `${path}.step`, errors, 0, 1e6) } : {}),
    ...(options && options.length ? { options } : {}),
    targets,
  };
}

/**
 * Validate and normalise an untrusted value into a GraphicTemplate. The result is
 * rebuilt from whitelisted fields only: unknown keys are dropped, so nothing the
 * author did not declare can reach the project (prototype pollution included).
 */
export function validateGraphicTemplate(input: unknown): GraphicValidation {
  const errors = new Errors();
  if (!isRecord(input)) return { ok: false, errors: ["template: must be an object"] };
  if (hasForbiddenKey(input)) return { ok: false, errors: ["template: contains a forbidden key"] };
  const version = input.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, errors: ["schemaVersion: must be a positive integer"] };
  }
  if (version > GRAPHIC_TEMPLATE_SCHEMA_VERSION) {
    return { ok: false, errors: [`schemaVersion: ${version} is newer than this version of OpenReel supports (${GRAPHIC_TEMPLATE_SCHEMA_VERSION}). Update OpenReel to open it.`] };
  }
  if (!Array.isArray(input.layers) || input.layers.length === 0) return { ok: false, errors: ["layers: needs at least one layer"] };
  if (input.layers.length > GRAPHIC_LIMITS.maxLayers) return { ok: false, errors: [`layers: more than ${GRAPHIC_LIMITS.maxLayers} layers`] };
  const parametersRaw = Array.isArray(input.parameters) ? input.parameters : [];
  if (parametersRaw.length > GRAPHIC_LIMITS.maxParameters) return { ok: false, errors: [`parameters: more than ${GRAPHIC_LIMITS.maxParameters} controls`] };

  const layerIds = new Set<string>();
  for (const entry of input.layers) {
    if (isRecord(entry) && typeof entry.id === "string") layerIds.add(entry.id);
  }
  if (layerIds.size !== input.layers.length) errors.add("layers", "layer ids must be unique");

  const budget: Budget = { embedded: 0 };
  const layers = input.layers.flatMap((raw, index) => {
    const parsed = layer(raw, index, errors, layerIds, budget);
    return parsed ? [parsed] : [];
  });
  if (budget.embedded > GRAPHIC_LIMITS.maxTotalEmbeddedBytes) errors.add("layers", "embedded assets are too large");
  const layerMap = new Map(layers.map((item) => [item.id, item]));
  const parameterIds = new Set<string>();
  const parameters = parametersRaw.flatMap((raw, index) => {
    const parsed = parameter(raw, index, errors, layerMap);
    if (!parsed) return [];
    if (parameterIds.has(parsed.id)) errors.add(`parameters[${index}].id`, "is used twice");
    parameterIds.add(parsed.id);
    return [parsed];
  });

  const template: GraphicTemplate = {
    schemaVersion: GRAPHIC_TEMPLATE_SCHEMA_VERSION,
    id: id(input.id, "id", errors),
    name: str(input.name, "name", errors, GRAPHIC_LIMITS.maxNameLength),
    category: oneOf(input.category ?? "custom", "category", errors, CATEGORIES, "custom"),
    description: str(input.description, "description", errors, GRAPHIC_LIMITS.maxStringLength, ""),
    tags: Array.isArray(input.tags)
      ? input.tags.slice(0, 24).map((tag, index) => str(tag, `tags[${index}]`, errors, 40))
      : [],
    duration: num(input.duration, "duration", errors, 0.1, GRAPHIC_LIMITS.maxDuration, 5),
    layers,
    parameters,
    ...(input.introDuration !== undefined ? { introDuration: num(input.introDuration, "introDuration", errors, 0, 60) } : {}),
    ...(input.outroDuration !== undefined ? { outroDuration: num(input.outroDuration, "outroDuration", errors, 0, 60) } : {}),
  };
  if (errors.list.length > 0) return { ok: false, errors: errors.list };
  return { ok: true, template };
}
