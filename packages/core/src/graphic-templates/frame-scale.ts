/**
 * Resolution independence for graphics when the sequence frame size changes
 * (Premiere's "Scale to frame size" counterpart for Essential Graphics, text
 * and shape clips).
 *
 * Overlay clips store positions as fractions of the frame but sizes in pixels
 * (font size, stroke, shadow) or as a multiple of a frame-relative base (shape
 * and SVG scale). Changing the frame therefore leaves a 1080p title oversized
 * and clipped at 640x360. These pure functions rescale the clips of the ACTIVE
 * sequence so everything keeps its proportion to the frame width. Graphic
 * instances are re-expanded against the new frame (their pins stay correct);
 * plain text / shape / SVG clips are rescaled in place. The caller commits the
 * result (settings included) as ONE undo step through the edit snapshot.
 */
import type { Keyframe } from "../types/timeline";
import type { Project, ProjectSettings } from "../types/project";
import type { ShapeClip, ShapeStyle, SVGClip } from "../graphics/types";
import type { TextClip, TextStyle } from "../text/types";
import { commitGraphicInstance } from "./instances";
import { GRAPHIC_LAYER_MEMBER_KEY } from "./types";

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

export const sameFrameSize = (a: FrameSize, b: FrameSize): boolean => a.width === b.width && a.height === b.height;

const valid = (frame: FrameSize): boolean =>
  Number.isFinite(frame.width) && Number.isFinite(frame.height) && frame.width > 0 && frame.height > 0;
const round = (value: number): number => Math.round(value * 1e6) / 1e6;

function scaleTextStyle(style: TextStyle, k: number): TextStyle {
  const next: { -readonly [P in keyof TextStyle]: TextStyle[P] } = { ...style, fontSize: round(style.fontSize * k) };
  if (style.strokeWidth !== undefined) next.strokeWidth = round(style.strokeWidth * k);
  if (style.shadowBlur !== undefined) next.shadowBlur = round(style.shadowBlur * k);
  if (style.shadowOffsetX !== undefined) next.shadowOffsetX = round(style.shadowOffsetX * k);
  if (style.shadowOffsetY !== undefined) next.shadowOffsetY = round(style.shadowOffsetY * k);
  if (style.letterSpacing) next.letterSpacing = round(style.letterSpacing * k);
  return next;
}

/** Shape local lengths live inside the clip's transform scale; see `scale` below. */
function scaleShapeStyle(style: ShapeStyle, m: number): ShapeStyle {
  const shadow = (item: NonNullable<ShapeStyle["shadow"]>) => ({
    ...item,
    blur: round(item.blur * m),
    offsetX: round(item.offsetX * m),
    offsetY: round(item.offsetY * m),
    ...(item.spread !== undefined ? { spread: round(item.spread * m) } : {}),
  });
  return {
    ...style,
    stroke: { ...style.stroke, width: round(style.stroke.width * m) },
    ...(style.shadow ? { shadow: shadow(style.shadow) } : {}),
    ...(style.shadows ? { shadows: style.shadows.map(shadow) } : {}),
    ...(style.cornerRadius !== undefined ? { cornerRadius: round(style.cornerRadius * m) } : {}),
    ...(style.cornerRadii
      ? {
        cornerRadii: {
          topLeft: round(style.cornerRadii.topLeft * m),
          topRight: round(style.cornerRadii.topRight * m),
          bottomRight: round(style.cornerRadii.bottomRight * m),
          bottomLeft: round(style.cornerRadii.bottomLeft * m),
        },
      }
      : {}),
  };
}

const scaleKeyframes = (keyframes: readonly Keyframe[], factor: number): Keyframe[] =>
  keyframes.map((key) =>
    (key.property === "scale.x" || key.property === "scale.y" || key.property === "scale") && typeof key.value === "number"
      ? { ...key, value: round(key.value * factor) }
      : key,
  );

const isMember = (clip: { readonly metadata?: { readonly [key: string]: unknown } }, owned: ReadonlySet<string>): boolean => {
  const owner = clip.metadata?.[GRAPHIC_LAYER_MEMBER_KEY];
  return typeof owner === "string" && owned.has(owner);
};

/**
 * Rescale the active sequence's graphics from frame `from` to frame `to`.
 * Does NOT change `settings`. Pure; returns the same project when nothing applies.
 */
export function scaleGraphicsToFrame(project: Project, from: FrameSize, to: FrameSize): Project {
  if (!valid(from) || !valid(to) || sameFrameSize(from, to)) return project;
  const k = to.width / from.width;
  const fromMin = Math.min(from.width, from.height);
  const toMin = Math.min(to.width, to.height);
  const m = toMin / fromMin;
  const activeTracks = new Set(project.timeline.tracks.map((track) => track.id));

  // Instances own their member clips: regenerate them against the new frame.
  const instances = (project.graphicInstances ?? []).filter((instance) => activeTracks.has(instance.trackId));
  const owned = new Set(instances.map((instance) => instance.id));

  const text = (clip: TextClip): TextClip =>
    activeTracks.has(clip.trackId) && !isMember(clip, owned)
      ? { ...clip, style: scaleTextStyle(clip.style, k) }
      : clip;
  const shape = (clip: ShapeClip): ShapeClip => {
    if (!activeTracks.has(clip.trackId) || isMember(clip, owned)) return clip;
    // Rendered size = scale * (0.15 * min(frame)): keep the pixel size proportional to the width.
    const f = (k * fromMin) / toMin;
    return {
      ...clip,
      style: scaleShapeStyle(clip.style, m),
      transform: { ...clip.transform, scale: { x: round(clip.transform.scale.x * f), y: round(clip.transform.scale.y * f) } },
      keyframes: scaleKeyframes(clip.keyframes, f),
    };
  };
  const svg = (clip: SVGClip): SVGClip => {
    if (!activeTracks.has(clip.trackId) || isMember(clip, owned)) return clip;
    // Rendered size = scale * (width if landscape else height), following the SVG's own aspect.
    const aspect = clip.viewBox.width / clip.viewBox.height;
    const base = (frame: FrameSize): number => (aspect > 1 ? frame.width : frame.height);
    const f = (k * base(from)) / base(to);
    return {
      ...clip,
      transform: { ...clip.transform, scale: { x: round(clip.transform.scale.x * f), y: round(clip.transform.scale.y * f) } },
      keyframes: scaleKeyframes(clip.keyframes, f),
    };
  };

  const scaled: Project = {
    ...project,
    textClips: project.textClips?.map(text),
    shapeClips: project.shapeClips?.map(shape),
    svgClips: project.svgClips?.map(svg),
  };
  // Expand the instances against the NEW frame, then hand the original settings back.
  let next: Project = { ...scaled, settings: { ...scaled.settings, width: to.width, height: to.height } };
  for (const instance of instances) next = commitGraphicInstance(next, instance);
  return { ...next, settings: project.settings };
}

export interface FrameChangeOptions {
  /** Rescale graphics with the frame (default true). */
  readonly scaleGraphics?: boolean;
}

/**
 * The next project for a sequence settings change. When the frame size changes
 * and `scaleGraphics` is not false, graphics follow the new frame. Pure.
 */
export function applySequenceSettings(
  project: Project,
  settings: Partial<ProjectSettings>,
  options: FrameChangeOptions = {},
): Project {
  const from: FrameSize = project.settings;
  const to: FrameSize = { width: settings.width ?? from.width, height: settings.height ?? from.height };
  const graphics = options.scaleGraphics !== false ? scaleGraphicsToFrame(project, from, to) : project;
  return { ...graphics, settings: { ...project.settings, ...settings }, modifiedAt: Date.now() };
}
