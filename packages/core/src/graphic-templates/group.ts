/**
 * Group ordinary text / shape / svg clips into one Essential Graphics graphic
 * (Premiere's "new graphic from layers"). The clips become the layers of a
 * template, their keyframes and text animations are carried over, and the text and
 * colors are auto-exposed as controls. One pure project edit (one undo step).
 */
import type { Project } from "../types/project";
import { EASING_TYPES, type EasingType } from "../types/timeline";
import type { ShapeClip, SVGClip } from "../graphics/types";
import type { TextClip } from "../text/types";
import { clipRuns, hasRunOverrides, scaleRuns } from "../text/rich-text";
import { clampGraphicDuration, designFrame } from "./expand";
import { commitGraphicInstance, graphicInstanceOfClip, type GraphicEditResult } from "./instances";
import {
  GRAPHIC_DESIGN_HEIGHT,
  GRAPHIC_DESIGN_WIDTH,
  GRAPHIC_TEMPLATE_SCHEMA_VERSION,
  type GraphicInstance,
  type GraphicKeyframeProperty,
  type GraphicLayer,
  type GraphicLayerKeyframe,
  type GraphicParameter,
  type GraphicTemplate,
} from "./types";
import { validateGraphicTemplate } from "./validate";

const fail = (message: string): GraphicEditResult => ({ ok: false, message });
const KEYFRAME_PROPERTIES = new Set<string>(["position.x", "position.y", "scale.x", "scale.y", "rotation", "opacity"]);
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/]+\))$/i;
const RAMP = 1 / 30;

type Source =
  | { readonly kind: "shape"; readonly clip: ShapeClip }
  | { readonly kind: "svg"; readonly clip: SVGClip }
  | { readonly kind: "text"; readonly clip: TextClip };

const goodColor = (value: unknown): string | undefined =>
  typeof value === "string" && COLOR.test(value.trim()) ? value.trim() : undefined;

function convertKeyframes(
  clip: { startTime: number; duration: number; keyframes: ReadonlyArray<{ time: number; property: string; value: unknown; easing: EasingType }>; transform: { opacity: number } },
  instanceStart: number,
  instanceEnd: number,
): GraphicLayerKeyframe[] {
  const out: GraphicLayerKeyframe[] = [];
  const lead = clip.startTime - instanceStart;
  const tail = instanceEnd - (clip.startTime + clip.duration);
  const own = clip.keyframes.filter((key) => KEYFRAME_PROPERTIES.has(key.property) && typeof key.value === "number" && Number.isFinite(key.value));
  for (const key of own) {
    const easing = (EASING_TYPES as readonly string[]).includes(key.easing) ? key.easing : "linear";
    const time = Math.max(0, key.time);
    if (time <= clip.duration / 2) out.push({ time: time + lead, anchor: "start", property: key.property as GraphicKeyframeProperty, value: key.value as number, easing });
    else out.push({ time: time - clip.duration - tail, anchor: "end", property: key.property as GraphicKeyframeProperty, value: key.value as number, easing });
  }
  // A clip that does not span the whole graphic is shown only while it was on screen.
  // (A clip that animates its own opacity keeps its keys and is shown for the whole graphic.)
  const animatesOpacity = own.some((key) => key.property === "opacity");
  if (!animatesOpacity) {
    const opacity = clip.transform.opacity;
    if (lead > 1e-6) {
      out.push({ time: Math.max(0, lead - RAMP), anchor: "start", property: "opacity", value: 0, easing: "linear" });
      out.push({ time: lead, anchor: "start", property: "opacity", value: opacity, easing: "linear" });
    }
    if (tail > 1e-6) {
      out.push({ time: -tail - RAMP, anchor: "end", property: "opacity", value: opacity, easing: "linear" });
      out.push({ time: -tail, anchor: "end", property: "opacity", value: 0, easing: "linear" });
    }
  }
  return out;
}

function textLayer(clip: TextClip, id: string, project: Project, start: number, end: number): GraphicLayer {
  const ds = designFrame(project.settings);
  const style = clip.style;
  const scale = Math.max(0.01, Math.abs(clip.transform.scale.x));
  const fontSize = (style.fontSize * scale) / ds.scale;
  const width = Math.max(60, Math.min(GRAPHIC_DESIGN_WIDTH * 2, Array.from(clip.text).length * fontSize * 0.58));
  const height = Math.max(20, fontSize * style.lineHeight * Math.max(1, clip.text.split("\n").length));
  const align = style.textAlign === "left" || style.textAlign === "right" ? style.textAlign : "center";
  const px = clip.transform.position.x * GRAPHIC_DESIGN_WIDTH;
  const cx = align === "left" ? px + width / 2 : align === "right" ? px - width / 2 : px;
  const cy = clip.transform.position.y * ds.height - ds.height / 2 + GRAPHIC_DESIGN_HEIGHT / 2;
  const styleOut: Record<string, unknown> = {
    fontFamily: style.fontFamily.slice(0, 100),
    fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textAlign: align,
    lineHeight: style.lineHeight,
    letterSpacing: (style.letterSpacing ?? 0) / ds.scale,
  };
  for (const key of ["color", "backgroundColor", "strokeColor", "shadowColor"] as const) {
    const color = goodColor(style[key]);
    if (color) styleOut[key] = color;
  }
  if (style.strokeWidth) styleOut.strokeWidth = style.strokeWidth / ds.scale;
  if (style.shadowBlur) styleOut.shadowBlur = style.shadowBlur / ds.scale;
  if (style.shadowOffsetX) styleOut.shadowOffsetX = style.shadowOffsetX / ds.scale;
  if (style.shadowOffsetY) styleOut.shadowOffsetY = style.shadowOffsetY / ds.scale;
  const keyframes = convertKeyframes(clip, start, end);
  const animation = clip.animation && clip.animation.preset !== "none" ? clip.animation : undefined;
  return {
    id, name: clip.text.split("\n")[0].slice(0, 40) || "Text", kind: "text", visible: true,
    x: cx, y: cy, width, height, rotation: clip.transform.rotation, opacity: Math.min(1, Math.max(0, clip.transform.opacity)),
    ...(keyframes.length ? { keyframes } : {}),
    // A keyframed text clip is animated by its keyframes; the preset only applies without them.
    ...(animation && keyframes.length === 0
      ? { textAnimation: { preset: animation.preset, inDuration: animation.inDuration, outDuration: animation.outDuration, ...(animation.stagger !== undefined ? { stagger: animation.stagger } : {}), ...(animation.unit ? { unit: animation.unit } : {}), params: animation.params as never } }
      : {}),
    text: {
      text: clip.text,
      style: styleOut as never,
      ...(hasRunOverrides(clip.runs) ? { runs: scaleRuns(clipRuns(clip), 1 / ds.scale) } : {}),
    },
  };
}

function shapeLayer(clip: ShapeClip, id: string, project: Project, start: number, end: number): GraphicLayer {
  const ds = designFrame(project.settings);
  const shapeSize = Math.min(project.settings.width, project.settings.height) * 0.15;
  const width = (Math.abs(clip.transform.scale.x) * shapeSize) / ds.scale;
  const height = (Math.abs(clip.transform.scale.y) * shapeSize) / ds.scale;
  const fill = clip.style.fill;
  const stroke = clip.style.stroke;
  const gradient = fill.type === "gradient" && fill.gradient && fill.gradient.type !== "conic" ? fill.gradient : undefined;
  const style: Record<string, unknown> = {
    fill: {
      type: fill.type === "none" ? "none" : gradient ? "gradient" : "solid",
      ...(goodColor(fill.color) ? { color: goodColor(fill.color) } : {}),
      opacity: fill.opacity,
      ...(gradient
        ? { gradient: { type: gradient.type, ...(gradient.angle !== undefined ? { angle: gradient.angle } : {}), stops: gradient.stops.map((stop) => ({ offset: stop.offset, color: goodColor(stop.color) ?? "#000000", ...(stop.opacity !== undefined ? { opacity: stop.opacity } : {}) })) } }
        : {}),
    },
    stroke: { ...(goodColor(stroke.color) ? { color: goodColor(stroke.color) } : {}), width: stroke.width, opacity: stroke.opacity },
    ...(clip.style.cornerRadius !== undefined ? { cornerRadius: clip.style.cornerRadius } : {}),
    ...(clip.style.points !== undefined ? { points: clip.style.points } : {}),
    ...(clip.style.innerRadius !== undefined ? { innerRadius: clip.style.innerRadius } : {}),
    ...(clip.style.shadow && goodColor(clip.style.shadow.color)
      ? { shadow: { color: goodColor(clip.style.shadow.color), blur: clip.style.shadow.blur, offsetX: clip.style.shadow.offsetX, offsetY: clip.style.shadow.offsetY } }
      : {}),
  };
  const keyframes = convertKeyframes(clip, start, end);
  return {
    id, name: clip.shapeType, kind: "shape", visible: true,
    x: clip.transform.position.x * GRAPHIC_DESIGN_WIDTH,
    y: clip.transform.position.y * ds.height - ds.height / 2 + GRAPHIC_DESIGN_HEIGHT / 2,
    width, height, rotation: clip.transform.rotation, opacity: Math.min(1, Math.max(0, clip.transform.opacity)),
    ...(keyframes.length ? { keyframes } : {}),
    shape: { shapeType: clip.shapeType, style: style as never },
  };
}

function svgLayer(clip: SVGClip, id: string, project: Project, start: number, end: number): GraphicLayer {
  const ds = designFrame(project.settings);
  const { width: pw, height: ph } = project.settings;
  const aspect = clip.viewBox.width / clip.viewBox.height;
  const baseW = aspect > 1 ? pw : ph * aspect;
  const baseH = aspect > 1 ? pw / aspect : ph;
  const keyframes = convertKeyframes(clip, start, end);
  const tint = clip.colorStyle && clip.colorStyle.colorMode !== "none" ? goodColor(clip.colorStyle.tintColor) : undefined;
  return {
    id, name: "SVG", kind: "svg", visible: true,
    x: clip.transform.position.x * GRAPHIC_DESIGN_WIDTH,
    y: clip.transform.position.y * ds.height - ds.height / 2 + GRAPHIC_DESIGN_HEIGHT / 2,
    width: (Math.abs(clip.transform.scale.x) * baseW) / ds.scale,
    height: (Math.abs(clip.transform.scale.y) * baseH) / ds.scale,
    rotation: clip.transform.rotation, opacity: Math.min(1, Math.max(0, clip.transform.opacity)),
    ...(keyframes.length ? { keyframes } : {}),
    svg: { svgContent: clip.svgContent, viewBoxWidth: clip.viewBox.width, viewBoxHeight: clip.viewBox.height, ...(tint ? { tintColor: tint } : {}) },
  };
}

export interface GroupOptions {
  readonly name?: string;
}

/** Ids of selected clips that can become graphic layers (text / shape / svg that are not already in a graphic). */
export function groupableClipIds(project: Project, clipIds: readonly string[]): string[] {
  const wanted = new Set(clipIds);
  const ids: string[] = [];
  for (const list of [project.shapeClips, project.svgClips, project.textClips] as const) {
    for (const clip of list ?? []) {
      if (!wanted.has(clip.id) || graphicInstanceOfClip(project, clip.id)) continue;
      if ("shapeType" in clip && clip.shapeType.startsWith("mesh-")) continue;
      ids.push(clip.id);
    }
  }
  return ids;
}

export function groupClipsIntoGraphic(project: Project, clipIds: readonly string[], options: GroupOptions = {}): GraphicEditResult {
  const wanted = new Set(groupableClipIds(project, clipIds));
  if (wanted.size === 0) return fail("Select text, shape or SVG clips to group into a graphic.");
  const sources: Source[] = [
    ...(project.shapeClips ?? []).filter((clip) => wanted.has(clip.id)).map((clip): Source => ({ kind: "shape", clip })),
    ...(project.svgClips ?? []).filter((clip) => wanted.has(clip.id)).map((clip): Source => ({ kind: "svg", clip })),
    ...(project.textClips ?? []).filter((clip) => wanted.has(clip.id)).map((clip): Source => ({ kind: "text", clip })),
  ];
  const tracks = new Map(project.timeline.tracks.map((track) => [track.id, track]));
  for (const source of sources) {
    const track = tracks.get(source.clip.trackId);
    if (!track) return fail("One of the clips is not on this sequence.");
    if (track.locked) return fail(`"${track.name}" is locked.`);
  }
  const start = Math.min(...sources.map((source) => source.clip.startTime));
  const end = Math.max(...sources.map((source) => source.clip.startTime + source.clip.duration));
  const duration = end - start;
  if (!(duration > 0)) return fail("The selected clips have no length.");

  const layers: GraphicLayer[] = [];
  const parameters: GraphicParameter[] = [];
  const counts = { text: 0, shape: 0, svg: 0 };
  for (const source of sources) {
    const n = ++counts[source.kind];
    const id = `${source.kind}-${n}`;
    if (source.kind === "text") {
      const layer = textLayer(source.clip, id, project, start, end);
      layers.push({ ...layer, name: layer.name || `Text ${n}` });
      parameters.push({
        id: `${id}-text`, label: layer.name || `Text ${n}`, group: "Text", type: "text",
        defaultValue: source.clip.text, targets: [{ layerId: id, property: "text" }],
      });
      parameters.push({
        id: `${id}-color`, label: `${layer.name || `Text ${n}`} color`, group: "Style", type: "color",
        defaultValue: goodColor(source.clip.style.color) ?? "#ffffff", targets: [{ layerId: id, property: "textColor" }],
      });
    } else if (source.kind === "shape") {
      const layer = shapeLayer(source.clip, id, project, start, end);
      layers.push({ ...layer, name: `${layer.name} ${n}` });
      if (source.clip.style.fill.type === "solid" && goodColor(source.clip.style.fill.color)) {
        parameters.push({
          id: `${id}-fill`, label: `${layer.name} ${n} color`, group: "Style", type: "color",
          defaultValue: goodColor(source.clip.style.fill.color) as string, targets: [{ layerId: id, property: "fill" }],
        });
      }
    } else {
      layers.push({ ...svgLayer(source.clip, id, project, start, end), name: `SVG ${n}` });
    }
  }

  const checked = validateGraphicTemplate({
    schemaVersion: GRAPHIC_TEMPLATE_SCHEMA_VERSION,
    id: `grouped-${crypto.randomUUID()}`,
    name: (options.name ?? "Graphic").trim() || "Graphic",
    category: "custom",
    description: "Grouped from timeline layers.",
    tags: ["grouped"],
    duration: clampGraphicDuration({ layers, introDuration: 0, outroDuration: 0 } as unknown as GraphicTemplate, duration),
    layers,
    parameters,
  });
  if (!checked.ok) return fail(`These clips cannot be grouped: ${checked.errors[0]}`);

  const first = sources[sources.length - 1].clip;
  const instance: GraphicInstance = {
    id: `graphic_${crypto.randomUUID()}`,
    name: checked.template.name,
    trackId: first.trackId,
    startTime: start,
    duration,
    template: checked.template,
    values: Object.fromEntries(checked.template.parameters.map((parameter) => [parameter.id, parameter.defaultValue])),
  };
  const removed = new Set(sources.map((source) => source.clip.id));
  const without: Project = {
    ...project,
    textClips: project.textClips?.filter((clip) => !removed.has(clip.id)),
    shapeClips: project.shapeClips?.filter((clip) => !removed.has(clip.id)),
    svgClips: project.svgClips?.filter((clip) => !removed.has(clip.id)),
  };
  return { ok: true, project: commitGraphicInstance(without, instance), instanceId: instance.id };
}
