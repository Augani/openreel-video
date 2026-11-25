import type { EasingType } from "../../types/timeline";
import type { TextRun, TextRunStyle, TextStyle } from "../../text/types";
import { hasRunOverrides, normalizeRuns } from "../../text/rich-text";
import type { ShapeStyle } from "../../graphics/types";
import {
  GRAPHIC_DESIGN_HEIGHT,
  GRAPHIC_DESIGN_WIDTH,
  GRAPHIC_TEMPLATE_SCHEMA_VERSION,
  type GraphicKeyframeProperty,
  type GraphicLayer,
  type GraphicLayerKeyframe,
  type GraphicParameter,
  type GraphicParamValue,
  type GraphicTemplate,
  type GraphicTemplateCategory,
} from "../types";
import { GRAPHIC_LIMITS, validateGraphicTemplate } from "../validate";
import { isAfterEffectsAuthor, parseMogrtDefinition } from "./definition";
import { parsePrgraphic, type PrgGraphic, type PrgLayer, type PrgProp, type PrgShadow, type PrgTextRun } from "./prgraphic";
import type {
  MogrtControl,
  MogrtDefinition,
  MogrtFailureReason,
  MogrtImportReport,
  MogrtImportResult,
  MogrtReportItem,
} from "./types";
import { readZip, ZipError, looksLikeZip, type ZipEntry } from "./zip";

/** Largest .mogrt accepted (compressed). Real ones are well under 20 MB even with video previews. */
export const MOGRT_MAX_BYTES = 64 * 1024 * 1024;
export const MOGRT_EXTENSION = ".mogrt";

const FONT_CHOICES = ["Inter", "Poppins", "Montserrat", "Roboto", "Oswald", "Playfair Display", "Bebas Neue"];

// ── report ──────────────────────────────────────────────────────────────────

class Report {
  readonly items: MogrtReportItem[] = [];
  add(severity: MogrtReportItem["severity"], feature: string, detail: string, layer?: string): void {
    this.items.push({ severity, feature, detail, ...(layer ? { layer } : {}) });
  }
  build(extra: Pick<MogrtImportReport, "layersImported" | "layersTotal" | "controlsImported" | "controlsTotal"> & { fileName?: string; authorApp?: string }, headline: string): MogrtImportReport {
    const dropped = this.items.filter((i) => i.severity === "dropped").length;
    const approximated = this.items.filter((i) => i.severity === "approximated").length;
    return {
      ...extra,
      items: this.items,
      dropped,
      approximated,
      summary: `${headline}${dropped || approximated ? ` ${dropped} dropped, ${approximated} approximated.` : ""}`.trim(),
    };
  }
}

const emptyCounts = { layersImported: 0, layersTotal: 0, controlsImported: 0, controlsTotal: 0 };

function failure(reason: MogrtFailureReason, message: string, report: Report, extra: { fileName?: string; authorApp?: string; controlsTotal?: number } = {}): MogrtImportResult {
  return {
    ok: false,
    reason,
    message,
    report: report.build({ ...emptyCounts, controlsTotal: extra.controlsTotal ?? 0, ...(extra.fileName ? { fileName: extra.fileName } : {}), ...(extra.authorApp ? { authorApp: extra.authorApp } : {}) }, message),
  };
}

// ── small helpers ───────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number, digits = 3): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "layer";
const safeId = (text: string): string => text.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80) || "id";
const base = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const ext = (path: string): string => {
  const name = base(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
};

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function withAlpha(color: string, alpha: number): string {
  if (alpha >= 0.999) return color;
  const hex = color.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!hex) return color;
  const existing = hex[2] ? parseInt(hex[2], 16) / 255 : 1;
  return `#${hex[1]}${Math.round(clamp(existing * alpha, 0, 1) * 255).toString(16).padStart(2, "0")}`;
}

/** "MyriadPro-Bold" -> { family: "Myriad Pro", style: "Bold" }; "Arial" -> { family: "Arial" }. */
export function splitFontName(name: string): { family: string; style?: string } {
  const trimmed = name.trim();
  const dash = trimmed.lastIndexOf("-");
  const familyRaw = dash > 0 ? trimmed.slice(0, dash) : trimmed;
  const style = dash > 0 ? trimmed.slice(dash + 1) : undefined;
  // CamelCase PostScript family ("MyriadPro", "ArialMT") -> words; plain names with spaces are left alone.
  const family = /\s/.test(familyRaw) ? familyRaw : familyRaw.replace(/MT$|PS$|PSMT$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return { family, ...(style ? { style } : {}) };
}

export function fontWeightOf(style: string | undefined): TextStyle["fontWeight"] {
  const s = (style ?? "").toLowerCase();
  if (/black|heavy|ultra/.test(s)) return /extra|ultra/.test(s) && !/heavy|black/.test(s) ? 800 : 900;
  if (/extra\s*bold|x-?bold/.test(s)) return 800;
  if (/semi\s*bold|demi/.test(s)) return 600;
  if (/bold/.test(s)) return 700;
  if (/medium/.test(s)) return 500;
  if (/extra\s*light|ultra\s*light|x-?light/.test(s)) return 200;
  if (/thin|hairline/.test(s)) return 100;
  if (/light/.test(s)) return 300;
  return 400;
}

/**
 * Styled text: each source run becomes a TextRun holding only what differs from
 * the layer style (which came from the first run). Lengths are design pixels.
 */
function mapTextRuns(
  source: readonly PrgTextRun[],
  base: Partial<TextStyle>,
  layerText: { readonly allCaps?: boolean },
  k: number,
  where: string,
  report: Report,
): TextRun[] | undefined {
  const baseSize = base.fontSize ?? 48;
  const runs: TextRun[] = source.map((run) => {
    const font = run.fontFamily ? splitFontName(run.fontFamily) : undefined;
    const styleName = run.fontStyle ?? font?.style;
    const style: Record<string, unknown> = {};
    if (font && font.family !== base.fontFamily) style.fontFamily = font.family;
    if (styleName !== undefined) {
      const weight = fontWeightOf(styleName);
      if (weight !== base.fontWeight) style.fontWeight = weight;
      const fontStyle = isItalic(styleName) ? "italic" : "normal";
      if (fontStyle !== base.fontStyle) style.fontStyle = fontStyle;
    }
    if (run.fontSize !== undefined) {
      const size = round(clamp(run.fontSize * k, 1, 2000), 2);
      if (size !== baseSize) style.fontSize = size;
    }
    if (run.color !== undefined && run.color !== base.color) style.color = run.color;
    if (run.tracking !== undefined) {
      const px = round(clamp((run.tracking / 1000) * (typeof style.fontSize === "number" ? style.fontSize : baseSize), -50, 200), 3);
      if (px !== (base.letterSpacing ?? 0)) style.letterSpacing = px;
    }
    if (run.baselineShift) style.baselineShift = round(run.baselineShift * k, 2);
    if (run.underline && base.textDecoration !== "underline") style.underline = true;
    const text = run.allCaps || layerText.allCaps ? run.text.toUpperCase() : run.text;
    return { text, style: style as TextRunStyle };
  });
  const merged = normalizeRuns(runs);
  if (!hasRunOverrides(merged)) return undefined;
  report.add("info", "Styled text", `${merged.length} styled runs mapped to per-character styling`, where);
  return merged;
}

const isItalic = (style: string | undefined): boolean => /italic|oblique/i.test(style ?? "");

function easingOf(interp: string): EasingType {
  const i = interp.toLowerCase().replace(/[\s_-]/g, "");
  if (i === "hold" || i === "step" || i === "stepped") return "hold";
  if (i === "linear") return "linear";
  if (i === "easein") return "ease-in";
  if (i === "easeout") return "ease-out";
  return "ease-in-out"; // bezier / auto bezier / continuous bezier / smooth
}

function alignOf(align: string | undefined): TextStyle["textAlign"] {
  const a = (align ?? "").toLowerCase();
  if (a.includes("right")) return "right";
  if (a.includes("cent")) return "center";
  if (a.includes("justify")) return "justify";
  return "left";
}

// ── property sampling ───────────────────────────────────────────────────────

/** Linear sample of a keyframed property at time t (value of the first / last key outside the range). */
function sample(prop: PrgProp | undefined, t: number, fallback: readonly number[]): readonly number[] {
  if (!prop) return fallback;
  const keys = prop.keys;
  if (keys.length === 0) return prop.value ?? fallback;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      if (a.interp === "hold" || a.interp === "step") return a.v;
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return a.v.map((v, j) => v + ((b.v[j] ?? v) - v) * f);
    }
  }
  return fallback;
}

interface Frame {
  readonly k: number;
  readonly ox: number;
  readonly oy: number;
}

interface Geometry {
  /** Box centre and size in design pixels at time t. */
  at(t: number): { cx: number; cy: number; w: number; h: number; sx: number; sy: number; rotation: number };
  readonly times: readonly number[];
}

function geometry(layer: PrgLayer, frame: Frame, size: { w: number; h: number }): Geometry {
  const b = { ...layer.bounds, w: size.w, h: size.h };
  const local = { x: layer.bounds.x + size.w / 2, y: layer.bounds.y + size.h / 2 };
  const anchor = layer.anchor ?? [local.x, local.y];
  const times = new Set<number>();
  for (const prop of [layer.position, layer.scale, layer.rotation]) for (const key of prop?.keys ?? []) times.add(key.t);
  return {
    times: [...times].sort((a, c) => a - c),
    at(t) {
      const s = sample(layer.scale, t, [100, 100]);
      const sx = (s[0] ?? 100) / 100;
      const sy = (s[1] ?? s[0] ?? 100) / 100;
      const pos = sample(layer.position, t, anchor);
      const rotation = sample(layer.rotation, t, [0])[0] ?? 0;
      const rad = (rotation * Math.PI) / 180;
      const dx = (local.x - anchor[0]) * sx;
      const dy = (local.y - (anchor[1] ?? anchor[0])) * sy;
      // y-down screen space: a positive (clockwise) rotation turns (x, y) by [cos -sin; sin cos].
      const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
      const px = (pos[0] ?? 0) + layer.groupOffset.x + rx;
      const py = (pos[1] ?? 0) + layer.groupOffset.y + ry;
      return {
        cx: frame.ox + px * frame.k,
        cy: frame.oy + py * frame.k,
        w: Math.max(1, b.w * sx * frame.k),
        h: Math.max(1, b.h * sy * frame.k),
        sx,
        sy,
        rotation,
      };
    },
  };
}

// ── layer mapping ───────────────────────────────────────────────────────────

interface Mapped {
  readonly source: PrgLayer;
  readonly layer: GraphicLayer;
}

interface Context {
  readonly report: Report;
  readonly frame: Frame;
  readonly duration: number;
  readonly outro: number | undefined;
  readonly zip: ReadonlyMap<string, ZipEntry>;
  embedded: number;
}

function shadowStyle(shadow: PrgShadow, k: number): { color: string; blur: number; offsetX: number; offsetY: number } {
  // Premiere / AE direction: 0 = up, clockwise. 135 = down-right.
  const rad = (shadow.angle * Math.PI) / 180;
  return {
    color: withAlpha("#" + (shadow.color.replace("#", "").slice(0, 6) || "000000"), shadow.opacity),
    blur: round(clamp(shadow.blur * k, 0, 200), 2),
    offsetX: round(clamp(Math.sin(rad) * shadow.distance * k, -500, 500), 2),
    offsetY: round(clamp(-Math.cos(rad) * shadow.distance * k, -500, 500), 2),
  };
}

function imageDataUrl(source: string | undefined, ctx: Context): { src: string } | { error: string } {
  if (!source) return { error: "no image source" };
  const wanted = source.replace(/\\/g, "/").replace(/^\.?\//, "");
  const entry = ctx.zip.get(wanted.toLowerCase()) ?? [...ctx.zip.values()].find((e) => base(e.name).toLowerCase() === base(wanted).toLowerCase());
  if (!entry) return { error: `"${source}" is not inside the archive` };
  const type = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[ext(entry.name)];
  if (!type) return { error: `${ext(entry.name) || "this"} images are not supported (png, jpeg, webp, gif are)` };
  if (entry.size > GRAPHIC_LIMITS.maxImageBytes) return { error: "the image is larger than 2 MB" };
  const bytes = entry.read();
  if (ctx.embedded + bytes.length > GRAPHIC_LIMITS.maxTotalEmbeddedBytes / 1.4) return { error: "embedded images would exceed the template size limit" };
  ctx.embedded += bytes.length;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { src: `data:${type};base64,${btoa(binary)}` };
}

function mapLayer(source: PrgLayer, index: number, ctx: Context): Mapped | undefined {
  const { report, frame } = ctx;
  const where = source.name;
  for (const feature of source.unsupported) report.add("dropped", `Layer ${feature.includes("applied") || feature.includes("mixed") || feature.includes("could not") ? "note" : feature}`, feature.includes("applied") || feature.includes("mixed") || feature.includes("could not") ? feature : `"${feature}" on this layer is not imported`, where);
  if (source.kind === "unsupported") {
    report.add("dropped", `${source.tag} layer`, `${source.tag} layers (paths, lines, polygons, vector art) are not imported; "${source.name}" was skipped`, where);
    return undefined;
  }

  const sizeNeeded = source.bounds.w > 0 && source.bounds.h > 0;
  let size = { w: source.bounds.w, h: source.bounds.h };
  const text = source.text;
  if (!sizeNeeded) {
    if (source.kind === "text" && text) {
      const fontSize = text.fontSize ?? 48;
      const lines = text.text.split("\n");
      size = { w: Math.max(...lines.map((l) => l.length), 1) * fontSize * 0.55, h: lines.length * fontSize * 1.2 };
      report.add("approximated", "Text box", "the layer has no bounding box, so its width was estimated from the text length", where);
    } else {
      size = { w: size.w || 100, h: size.h || 100 };
      report.add("approximated", "Layer size", "the layer has no bounding box; a 100 px box was assumed", where);
    }
  }
  const geo = geometry(source, frame, size);
  // Baked at the fullest scale of an animated scale (a grow-in starts at 0): keyframes then move relative to it.
  let restT = 0;
  const scaleKeys = source.scale?.keys ?? [];
  if (scaleKeys.length >= 2) restT = scaleKeys.reduce((best, key) => ((key.v[0] ?? 100) * (key.v[1] ?? key.v[0] ?? 100) > (best.v[0] ?? 100) * (best.v[1] ?? best.v[0] ?? 100) ? key : best)).t;
  const rest = geo.at(restT);
  const opacityStatic = clamp(((source.opacity?.keys[0]?.v[0] ?? source.opacity?.value?.[0]) ?? 100) / 100, 0, 1) * source.groupOpacity;

  const id = `l${index + 1}-${slug(source.name)}`;
  const common = {
    id,
    name: source.name.slice(0, GRAPHIC_LIMITS.maxNameLength),
    visible: source.visible,
    x: round(rest.cx, 2),
    y: round(rest.cy, 2),
    width: round(rest.w, 2),
    height: round(rest.h, 2),
    rotation: round(rest.rotation, 3),
    opacity: round(opacityStatic, 4),
  };

  let layer: GraphicLayer;
  if (source.kind === "text" && text) {
    const font = text.fontFamily ? splitFontName(text.fontFamily) : { family: "Inter" as string, style: undefined as string | undefined };
    if (!text.fontFamily) report.add("approximated", "Font", "the layer names no font; Inter was used", where);
    const style = text.fontStyle ?? font.style;
    const fontSize = round(clamp((text.fontSize ?? 48) * rest.sy * frame.k, 1, 2000), 2);
    if (Math.abs(rest.sx - rest.sy) > 0.01) report.add("approximated", "Non-uniform scale", "text scaled differently in X and Y is imported with the vertical scale", where);
    const tracking = text.tracking !== undefined ? round(clamp((text.tracking / 1000) * fontSize, -50, 200), 3) : 0;
    const textStyle: Partial<TextStyle> = {
      fontFamily: font.family,
      fontSize,
      fontWeight: fontWeightOf(style),
      fontStyle: isItalic(style) ? "italic" : "normal",
      color: text.color ?? "#ffffff",
      textAlign: alignOf(text.align),
      lineHeight: text.leading !== undefined ? round(clamp((text.leading * frame.k) / fontSize, 0.2, 5), 3) : 1.2,
      letterSpacing: tracking,
      ...(text.underline ? { textDecoration: "underline" as const } : {}),
      ...(text.stroke ? { strokeColor: text.stroke.color, strokeWidth: round(clamp(text.stroke.width * frame.k, 0, 100), 2) } : {}),
    };
    if (text.shadow) {
      const s = shadowStyle(text.shadow, frame.k);
      Object.assign(textStyle, { shadowColor: s.color, shadowBlur: s.blur, shadowOffsetX: s.offsetX, shadowOffsetY: s.offsetY });
    }
    if (text.allCaps) report.add("approximated", "All caps", "capitalised in the default text; a text edit in OpenReel is not forced to capitals", where);
    if (text.tracking !== undefined && text.tracking !== 0) report.add("info", "Tracking", `${text.tracking}/1000 em converted to ${tracking}px`, where);
    const runs = text.runs ? mapTextRuns(text.runs, textStyle, text, rest.sy * frame.k, where, report) : undefined;
    const content = runs ? runs.map((r) => r.text).join("") : text.allCaps ? text.text.toUpperCase() : text.text;
    layer = { ...common, kind: "text", text: { text: content, style: textStyle, ...(runs ? { runs } : {}) } };
  } else if (source.kind === "shape" && source.shape) {
    const shape = source.shape;
    const style: Partial<ShapeStyle> = {
      fill: shape.gradient
        ? { type: "gradient", opacity: 1, gradient: { type: shape.gradient.type, angle: shape.gradient.angle, stops: shape.gradient.stops.map((s) => ({ offset: s.offset, color: s.color })) } }
        : shape.fill
          ? { type: "solid", color: shape.fill, opacity: 1 }
          : { type: "none", opacity: 1 },
      stroke: shape.stroke
        ? { color: shape.stroke.color, width: round(clamp(shape.stroke.width * frame.k, 0, 200), 2), opacity: 1 }
        : { color: "#000000", width: 0, opacity: 1 },
      ...(shape.cornerRadius !== undefined && shape.type === "rectangle" ? { cornerRadius: round(clamp(shape.cornerRadius * frame.k, 0, 2000), 2) } : {}),
      ...(shape.shadow ? { shadow: shadowStyle(shape.shadow, frame.k) } : {}),
    };
    if (shape.gradient) report.add("info", "Gradient fill", "linear / radial gradient imported; the angle convention is passed through unchanged", where);
    layer = { ...common, kind: "shape", shape: { shapeType: shape.type, style } };
  } else if (source.kind === "image") {
    const image = imageDataUrl(source.imageSource, ctx);
    if ("error" in image) {
      report.add("dropped", "Image layer", `${image.error}; "${source.name}" was skipped`, where);
      return undefined;
    }
    layer = { ...common, kind: "image", image: { src: image.src, aspect: round(Math.max(0.01, size.w / Math.max(1, size.h)), 4) } };
  } else {
    return undefined;
  }

  // Keyframes: positions are frame fractions of the box centre (left / right edge for left / right aligned text),
  // scale is relative to the rest scale, rotation is absolute degrees, opacity is absolute 0-1.
  const keyframes = buildKeyframes(source, geo, layer, rest, ctx);
  if (keyframes.length) layer = { ...layer, keyframes };
  return { source, layer };
}

function anchorTime(t: number, ctx: Context): { time: number; anchor: "start" | "end" } {
  if (ctx.outro && ctx.outro > 0 && t > ctx.duration - ctx.outro + 1e-6) return { time: round(Math.min(0, t - ctx.duration), 4), anchor: "end" };
  return { time: round(Math.max(0, t), 4), anchor: "start" };
}

function buildKeyframes(source: PrgLayer, geo: Geometry, layer: GraphicLayer, rest: ReturnType<Geometry["at"]>, ctx: Context): GraphicLayerKeyframe[] {
  const out: GraphicLayerKeyframe[] = [];
  const { frame } = ctx;
  const push = (t: number, property: GraphicKeyframeProperty, value: number, interp: string) => {
    if (!Number.isFinite(value) || t > 3600) return;
    const a = anchorTime(t, ctx);
    out.push({ time: a.time, anchor: a.anchor, property, value: round(value, 5), easing: easingOf(interp) });
  };
  const interpAt = (prop: PrgProp | undefined, t: number): string => [...(prop?.keys ?? [])].reverse().find((k) => k.t <= t + 1e-9)?.interp ?? "linear";
  const animated = (prop: PrgProp | undefined) => (prop?.keys.length ?? 0) >= 2;

  const moves = animated(source.position) || animated(source.scale) || animated(source.rotation);
  const centreMoves = animated(source.position) || (moves && (source.anchor !== undefined));
  if (centreMoves) {
    const shift = layer.kind === "text" ? (layer.text?.style.textAlign === "left" ? -1 : layer.text?.style.textAlign === "right" ? 1 : 0) : 0;
    for (const t of geo.times) {
      const g = geo.at(t);
      const edge = (shift * g.w) / 2;
      const interp = interpAt(source.position, t);
      push(t, "position.x", (g.cx + edge) / GRAPHIC_DESIGN_WIDTH, interp);
      push(t, "position.y", g.cy / GRAPHIC_DESIGN_HEIGHT, interp);
    }
  }
  if (animated(source.scale)) {
    for (const t of geo.times) {
      const g = geo.at(t);
      const interp = interpAt(source.scale, t);
      push(t, "scale.x", g.sx / Math.max(1e-6, rest.sx), interp);
      push(t, "scale.y", g.sy / Math.max(1e-6, rest.sy), interp);
    }
  }
  if (animated(source.rotation)) {
    for (const key of source.rotation!.keys) push(key.t, "rotation", key.v[0] ?? 0, key.interp);
  }
  if (animated(source.opacity)) {
    for (const key of source.opacity!.keys) push(key.t, "opacity", clamp((key.v[0] ?? 100) / 100, 0, 1) * source.groupOpacity, key.interp);
  }
  void frame;
  return out;
}

// ── controls ────────────────────────────────────────────────────────────────

const PROPERTY_ALIASES: Array<[RegExp, string]> = [
  [/source\s*text|^text$/i, "text"],
  [/stroke\s*colou?r/i, "strokeColor"],
  [/stroke\s*(width|size)/i, "strokeWidth"],
  [/fill\s*colou?r|^colou?r$|^fill$/i, "fillColor"],
  [/font\s*size|^size$/i, "fontSize"],
  [/^font|typeface/i, "font"],
  [/opacity/i, "opacity"],
  [/rotation|angle/i, "rotation"],
  [/^scale/i, "scale"],
  [/position|^point$/i, "position"],
  [/visible|visibility|^enabled$|show/i, "visible"],
];

function normaliseProperty(name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const [pattern, normal] of PROPERTY_ALIASES) if (pattern.test(name.trim())) return normal;
  return undefined;
}

function guessProperty(control: MogrtControl): string | undefined {
  const named = normaliseProperty(control.name.replace(/^.*?\b(?=(stroke|fill|font|opacity|rotation|scale|position|visible))/i, ""));
  switch (control.kind) {
    case "text": return "text";
    case "font": return "font";
    case "checkbox": return "visible";
    case "point": return "position";
    case "color": return named === "strokeColor" ? "strokeColor" : "fillColor";
    case "slider": return named && ["opacity", "rotation", "fontSize", "strokeWidth", "scale"].includes(named) ? named : undefined;
    default: return undefined;
  }
}

interface Target {
  readonly mapped: Mapped;
  readonly property: string;
  readonly how: "control-id" | "definition" | "name";
}

function resolveTargets(control: MogrtControl, mapped: readonly Mapped[]): Target[] {
  const targets: Target[] = [];
  const seen = new Set<string>();
  const add = (m: Mapped, property: string, how: Target["how"]) => {
    const key = `${m.layer.id}:${property}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ mapped: m, property, how });
    }
  };
  // 1. The graphic ties its properties to controls with ControlID attributes.
  for (const m of mapped) for (const [property, controlId] of Object.entries(m.source.controls)) if (controlId === control.id) add(m, property, "control-id");
  if (targets.length) return targets;
  // 2. The definition names the layer and property.
  for (const binding of control.bindings) {
    const layerKey = binding.layer?.toLowerCase();
    const m = layerKey ? mapped.find((x) => x.source.id.toLowerCase() === layerKey || x.source.name.toLowerCase() === layerKey) : undefined;
    const property = normaliseProperty(binding.property) ?? guessProperty(control);
    if (m && property) add(m, property, "definition");
  }
  if (targets.length) return targets;
  // 3. By name: "Title", "Title Colour", "Title Size" belong to the layer called "Title".
  const property = guessProperty(control);
  if (!property) return targets;
  const needle = control.name.toLowerCase();
  const byName = [...mapped]
    .filter((m) => m.source.name.length > 0 && needle.includes(m.source.name.toLowerCase()))
    .sort((a, b) => b.source.name.length - a.source.name.length)[0];
  if (byName) {
    add(byName, property, "name");
    return targets;
  }
  if (control.kind === "text") {
    const textLayer = mapped.find((m) => m.layer.kind === "text");
    if (textLayer) add(textLayer, "text", "name");
  }
  return targets;
}

interface ParamBuild {
  readonly parameters: GraphicParameter[];
  readonly imported: Set<string>;
}

function describeHow(t: Target): string {
  return t.how === "control-id" ? "" : t.how === "definition" ? "" : ` (matched by name: no explicit binding was found)`;
}

function buildParameters(definition: MogrtDefinition, mapped: readonly Mapped[], ctx: Context): ParamBuild {
  const { report } = ctx;
  const parameters: GraphicParameter[] = [];
  const imported = new Set<string>();
  const used = new Set<string>();
  const uid = (raw: string): string => {
    let id = `ctl-${safeId(raw)}`.slice(0, 80);
    let n = 2;
    while (used.has(id)) id = `${id.slice(0, 74)}-${n++}`;
    used.add(id);
    return id;
  };
  const push = (p: Omit<GraphicParameter, "id"> & { idSeed: string }) => {
    const { idSeed, ...rest } = p;
    parameters.push({ id: uid(idSeed), ...rest });
  };

  for (const control of definition.controls) {
    const label = control.name.slice(0, GRAPHIC_LIMITS.maxNameLength);
    const targets = resolveTargets(control, mapped);
    const group = control.group;
    const feature = `Control: ${label}`;

    if (control.kind === "media") {
      report.add("dropped", feature, "media-replacement controls are not supported: the placeholder stays as the template's own image (or is absent)");
      continue;
    }
    if (control.kind === "unknown") {
      report.add("dropped", feature, `control type ${control.rawType || "(none)"} is not recognised`);
      continue;
    }
    if (targets.length === 0) {
      report.add("dropped", feature, "no layer property in the graphic is tied to this control");
      continue;
    }
    for (const t of targets) {
      const note = describeHow(t);
      if (note) report.add("approximated", feature, `bound to layer "${t.mapped.source.name}"${note}`, t.mapped.source.name);
    }

    const accepted: Array<{ layerId: string; property: GraphicParameter["targets"][number]["property"] }> = [];
    let defaultValue: GraphicParamValue | undefined;
    let type: GraphicParameter["type"] = "text";
    let min: number | undefined;
    let max: number | undefined;
    let step: number | undefined;
    let options: string[] | undefined;

    const reject = (t: Target, why: string) => report.add("dropped", feature, `${why} (layer "${t.mapped.source.name}")`, t.mapped.source.name);

    for (const t of targets) {
      const layer = t.mapped.layer;
      switch (control.kind) {
        case "text": {
          if (t.property !== "text" || layer.kind !== "text") { reject(t, `a text control can only drive text, not ${t.property}`); break; }
          accepted.push({ layerId: layer.id, property: "text" });
          type = "text";
          defaultValue ??= control.defaultValue !== undefined && typeof control.defaultValue === "string" ? control.defaultValue : layer.text?.text ?? "";
          break;
        }
        case "font": {
          if (layer.kind !== "text") { reject(t, "a font control needs a text layer"); break; }
          accepted.push({ layerId: layer.id, property: "fontFamily" });
          type = "font";
          const family = typeof control.defaultValue === "string" ? splitFontName(control.defaultValue).family : layer.text?.style.fontFamily ?? "Inter";
          defaultValue ??= family;
          options = [...new Set([family, ...FONT_CHOICES])];
          break;
        }
        case "color": {
          const wantsStroke = t.property === "strokeColor";
          if (layer.kind === "text") {
            if (wantsStroke) { reject(t, "text stroke colour cannot be edited in OpenReel; the stroke keeps its imported colour"); break; }
            accepted.push({ layerId: layer.id, property: "textColor" });
            defaultValue ??= control.defaultValue !== undefined ? String(control.defaultValue) : layer.text?.style.color ?? "#ffffff";
          } else if (layer.kind === "shape") {
            accepted.push({ layerId: layer.id, property: wantsStroke ? "strokeColor" : "fill" });
            defaultValue ??= control.defaultValue !== undefined ? String(control.defaultValue) : (wantsStroke ? layer.shape?.style.stroke?.color : layer.shape?.style.fill?.color) ?? "#ffffff";
          } else { reject(t, "colour controls drive text and shape layers"); break; }
          type = "color";
          break;
        }
        case "checkbox": {
          accepted.push({ layerId: layer.id, property: "visible" });
          type = "checkbox";
          defaultValue ??= typeof control.defaultValue === "boolean" ? control.defaultValue : layer.visible;
          break;
        }
        case "point": {
          accepted.push({ layerId: layer.id, property: "position" });
          type = "position";
          defaultValue ??= { x: layer.x, y: layer.y };
          break;
        }
        case "slider": {
          type = "slider";
          const sliderDefault = typeof control.defaultValue === "number" ? control.defaultValue : undefined;
          if (t.property === "opacity") {
            accepted.push({ layerId: layer.id, property: "opacity" });
            defaultValue ??= clamp((sliderDefault ?? layer.opacity * 100) / 100, 0, 1);
            min = 0; max = 1; step = 0.01;
          } else if (t.property === "rotation") {
            accepted.push({ layerId: layer.id, property: "rotation" });
            defaultValue ??= sliderDefault ?? layer.rotation;
            min = control.min ?? -360; max = control.max ?? 360; step = control.step ?? 1;
          } else if (t.property === "fontSize" && layer.kind === "text") {
            accepted.push({ layerId: layer.id, property: "fontSize" });
            defaultValue ??= sliderDefault !== undefined ? sliderDefault * ctx.frame.k : layer.text?.style.fontSize ?? 48;
            min = control.min !== undefined ? control.min * ctx.frame.k : 6; max = control.max !== undefined ? control.max * ctx.frame.k : 400; step = 1;
          } else if (t.property === "strokeWidth" && layer.kind === "shape") {
            accepted.push({ layerId: layer.id, property: "strokeWidth" });
            defaultValue ??= sliderDefault ?? layer.shape?.style.stroke?.width ?? 0;
            min = control.min ?? 0; max = control.max ?? 50; step = control.step ?? 1;
          } else {
            reject(t, `a slider bound to "${t.property}" cannot be mapped (OpenReel sliders drive opacity, rotation, font size and shape stroke width)`);
          }
          break;
        }
        default: break;
      }
    }
    if (accepted.length === 0) continue;

    if (type === "slider") {
      const value = defaultValue as number;
      min = Math.min(min ?? value, value);
      max = Math.max(max ?? value, value);
      if (min === max) max = min + 1;
    }
    push({
      idSeed: control.id,
      label,
      ...(group ? { group: group.slice(0, GRAPHIC_LIMITS.maxNameLength) } : {}),
      type,
      defaultValue: defaultValue as GraphicParamValue,
      ...(min !== undefined ? { min: round(min, 4) } : {}),
      ...(max !== undefined ? { max: round(max, 4) } : {}),
      ...(step !== undefined ? { step } : {}),
      ...(options ? { options } : {}),
      targets: accepted.slice(0, GRAPHIC_LIMITS.maxTargetsPerParameter),
    });
    imported.add(control.id);

    // Premiere exposes font family and size as part of a text control (capPropFontEdit / capPropFontSizeEdit).
    if (control.kind === "text" && control.font) {
      const textTargets = accepted.filter((a) => a.property === "text");
      const layers = textTargets.map((a) => mapped.find((m) => m.layer.id === a.layerId)?.layer).filter((l): l is GraphicLayer => !!l);
      if (control.font.fontEditable && layers.length) {
        const family = layers[0].text?.style.fontFamily ?? "Inter";
        push({
          idSeed: `${control.id}-font`, label: `${label} font`, ...(group ? { group } : {}), type: "font", defaultValue: family,
          options: [...new Set([family, ...FONT_CHOICES])], targets: layers.map((l) => ({ layerId: l.id, property: "fontFamily" as const })),
        });
      }
      if (control.font.fontSizeEditable && layers.length) {
        const size = layers[0].text?.style.fontSize ?? 48;
        push({
          idSeed: `${control.id}-size`, label: `${label} size`, ...(group ? { group } : {}), type: "slider", defaultValue: size,
          min: Math.min(6, size), max: Math.max(400, size), step: 1, targets: layers.map((l) => ({ layerId: l.id, property: "fontSize" as const })),
        });
      }
    }
  }
  return { parameters, imported };
}

// ── entry point ─────────────────────────────────────────────────────────────

function guessCategory(name: string, graphic: PrgGraphic): GraphicTemplateCategory {
  const n = name.toLowerCase();
  if (/lower[\s_-]*third|name[\s_-]*(tag|strap)|\blt\b/.test(n)) return "lower-third";
  if (/end[\s_-]*(card|screen)|outro|credits/.test(n)) return "end-card";
  if (/call[\s_-]*out|callout|bubble|label/.test(n)) return "callout";
  if (/title|intro|opener|headline|heading/.test(n)) return "title";
  const textLayers = graphic.layers.filter((l) => l.kind === "text");
  if (textLayers.length >= 1 && graphic.layers.length <= 4) {
    // A bar near the bottom of the frame: lower third.
    const low = graphic.layers.some((l) => l.kind === "shape" && (l.position?.value?.[1] ?? 0) > graphic.height * 0.65);
    if (low) return "lower-third";
  }
  return "custom";
}

export interface ImportMogrtOptions {
  /** Original file name, used for the template name when the archive has none. */
  readonly fileName?: string;
}

/**
 * Import a Premiere-authored .mogrt (zip bytes) as a GraphicTemplate plus an import report. Never throws: a file that
 * cannot be imported (not a zip, After Effects authored, no graphic, invalid) comes back as `{ ok: false }` with a
 * clear reason.
 */
export async function importMogrt(bytes: Uint8Array, options: ImportMogrtOptions = {}): Promise<MogrtImportResult> {
  const report = new Report();
  const fileName = options.fileName;
  const fail = (reason: MogrtFailureReason, message: string, extra: { authorApp?: string; controlsTotal?: number } = {}) =>
    failure(reason, message, report, { ...(fileName ? { fileName } : {}), ...extra });

  if (bytes.length > MOGRT_MAX_BYTES) return fail("too-large", `That file is larger than ${MOGRT_MAX_BYTES / 1048576} MB, which is more than a template should be.`);
  if (!looksLikeZip(bytes)) return fail("not-a-zip", "That file is not a .mogrt: a Motion Graphics Template is a zip archive.");

  let entries: ZipEntry[];
  try {
    entries = readZip(bytes);
  } catch (error) {
    return fail("unreadable", error instanceof ZipError ? error.message : "The archive could not be read.");
  }
  const zip = new Map<string, ZipEntry>();
  for (const entry of entries) if (!entry.isDirectory) zip.set(entry.name.toLowerCase().replace(/^\.?\//, ""), entry);
  const find = (pattern: RegExp): ZipEntry | undefined => [...zip.values()].find((e) => pattern.test(base(e.name)));

  const definitionEntry = find(/^definition\.json$/i);
  let definition: MogrtDefinition | undefined;
  if (definitionEntry) {
    try {
      definition = parseMogrtDefinition(new TextDecoder("utf-8").decode(definitionEntry.read()));
    } catch (error) {
      report.add("dropped", "definition.json", error instanceof Error ? error.message : "could not be read");
    }
  } else {
    report.add("dropped", "definition.json", "the archive has no definition.json, so the template has no editable controls");
  }
  const authorApp = definition?.authorApp;
  const controlsTotal = definition?.controls.length ?? 0;

  const prgraphic = find(/\.prgraphic$/i);
  const prproj = find(/\.prproj$/i);
  const aegraphic = find(/\.(aegraphic|aep|aepx)$/i);

  if (isAfterEffectsAuthor(authorApp) || (aegraphic && !prgraphic && !prproj)) {
    const names = definition?.controls.map((c) => c.name).slice(0, 12) ?? [];
    report.add("info", "After Effects template", `${aegraphic ? `"${base(aegraphic.name)}" is an After Effects composition` : "definition.json says it was authored in After Effects"}; it can only be rendered by After Effects / Premiere's own engine`);
    if (names.length) report.add("info", "Editable controls found", names.join(", ") + (controlsTotal > names.length ? `, and ${controlsTotal - names.length} more` : ""));
    return fail(
      "after-effects",
      "This .mogrt was authored in After Effects. Its composition (.aegraphic) cannot be rendered outside Adobe's engine, so it was not imported. Templates built in Premiere Pro's Essential Graphics can be.",
      { ...(authorApp ? { authorApp } : {}), controlsTotal },
    );
  }

  const graphicEntry = prgraphic ?? prproj;
  if (!graphicEntry) {
    return fail("no-graphic", "This archive has no Premiere graphic (.prgraphic or project.prproj), so there is nothing to import.", { ...(authorApp ? { authorApp } : {}), controlsTotal });
  }

  let graphic: PrgGraphic;
  try {
    graphic = await parsePrgraphic(graphicEntry.read());
  } catch (error) {
    return fail("invalid", error instanceof Error ? error.message : "The graphic could not be read.", { ...(authorApp ? { authorApp } : {}), controlsTotal });
  }
  if (graphic.layers.length === 0) {
    return fail("no-graphic", `"${base(graphicEntry.name)}" holds no text, shape or image layers that could be read.`, { ...(authorApp ? { authorApp } : {}), controlsTotal });
  }
  if (graphic.layers.length > GRAPHIC_LIMITS.maxLayers) {
    return fail("invalid", `The graphic has ${graphic.layers.length} layers; at most ${GRAPHIC_LIMITS.maxLayers} are supported.`, { ...(authorApp ? { authorApp } : {}), controlsTotal });
  }
  for (const note of graphic.notes) report.add("approximated", "Graphic", note);

  // Fit the authored composition into the 1920x1080 design frame.
  const k = Math.min(GRAPHIC_DESIGN_WIDTH / graphic.width, GRAPHIC_DESIGN_HEIGHT / graphic.height);
  const frame: Frame = { k, ox: (GRAPHIC_DESIGN_WIDTH - graphic.width * k) / 2, oy: (GRAPHIC_DESIGN_HEIGHT - graphic.height * k) / 2 };
  if (Math.abs(k - 1) > 1e-6) report.add("approximated", "Frame size", `the graphic was authored at ${graphic.width}x${graphic.height} and is fitted into OpenReel's 1920x1080 design frame`);

  const maxKey = Math.max(0, ...graphic.layers.flatMap((l) => [l.position, l.scale, l.rotation, l.opacity].flatMap((p) => p?.keys.map((key) => key.t) ?? [])));
  const duration = clamp(graphic.duration ?? definition?.duration ?? (maxKey > 0 ? maxKey + 1 : 5), 0.1, GRAPHIC_LIMITS.maxDuration);
  const outro = graphic.outroDuration && graphic.outroDuration > 0 ? graphic.outroDuration : undefined;
  const ctx: Context = { report, frame, duration, outro, zip, embedded: 0 };

  const mapped: Mapped[] = [];
  graphic.layers.forEach((source, index) => {
    const result = mapLayer(source, index, ctx);
    if (result) mapped.push(result);
  });
  if (mapped.length === 0) {
    return fail("no-graphic", "None of the graphic's layers could be imported (only text, rectangles, ellipses and images are supported).", { ...(authorApp ? { authorApp } : {}), controlsTotal });
  }

  const built = definition ? buildParameters(definition, mapped, ctx) : { parameters: [] as GraphicParameter[], imported: new Set<string>() };
  if (definition?.unreadKeys.length) report.add("info", "definition.json", `fields not read: ${definition.unreadKeys.slice(0, 8).join(", ")}`);

  const nameBase = (definition?.name ?? graphic.name ?? (fileName ? fileName.replace(/\.mogrt$/i, "") : "Imported template")).trim() || "Imported template";
  const fingerprint = hash(`${nameBase}|${mapped.map((m) => m.layer.id + m.layer.x + m.layer.y).join(",")}|${definition?.controls.map((c) => c.id).join(",") ?? ""}`);
  const candidate: GraphicTemplate = {
    schemaVersion: GRAPHIC_TEMPLATE_SCHEMA_VERSION,
    id: `mogrt-${slug(nameBase)}-${fingerprint}`.slice(0, 80),
    name: nameBase.slice(0, GRAPHIC_LIMITS.maxNameLength),
    category: guessCategory(nameBase, graphic),
    description: (definition?.description ?? `Imported from ${fileName ?? "a .mogrt"}${authorApp ? ` (authored in ${authorApp})` : ""}.`).slice(0, GRAPHIC_LIMITS.maxStringLength),
    tags: ["mogrt", "premiere", "imported"],
    duration: round(duration, 3),
    layers: mapped.map((m) => m.layer),
    parameters: built.parameters,
    ...(graphic.introDuration !== undefined ? { introDuration: clamp(graphic.introDuration, 0, 60) } : {}),
    ...(graphic.outroDuration !== undefined ? { outroDuration: clamp(graphic.outroDuration, 0, 60) } : {}),
  };
  const checked = validateGraphicTemplate(candidate);
  if (!checked.ok) {
    return fail("invalid", `The imported template did not pass validation: ${checked.errors[0] ?? "unknown error"}`, { ...(authorApp ? { authorApp } : {}), controlsTotal });
  }

  const thumb = [...zip.values()].find((e) => /^(thumb|thumbnail|preview).*\.(png|jpe?g)$/i.test(base(e.name)) && e.size < 600_000);
  let thumbnail: string | undefined;
  if (thumb) {
    try {
      const data = thumb.read();
      let binary = "";
      for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
      thumbnail = `data:image/${/png$/i.test(thumb.name) ? "png" : "jpeg"};base64,${btoa(binary)}`;
    } catch {
      thumbnail = undefined;
    }
  }
  const preview = find(/\.(mp4|mov|webm)$/i);
  if (preview) report.add("info", "Preview video", `"${base(preview.name)}" is Premiere's own preview render and is not imported`);

  const report_ = report.build(
    {
      ...(fileName ? { fileName } : {}),
      ...(authorApp ? { authorApp } : {}),
      layersImported: mapped.length,
      layersTotal: graphic.layers.length,
      controlsImported: built.imported.size,
      controlsTotal,
    },
    `Imported "${checked.template.name}": ${mapped.length} of ${graphic.layers.length} layers, ${built.imported.size} of ${controlsTotal} controls.`,
  );
  return { ok: true, template: checked.template, report: report_, ...(thumbnail ? { thumbnail } : {}) };
}
