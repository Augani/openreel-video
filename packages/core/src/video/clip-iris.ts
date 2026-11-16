import type { Keyframe } from "../types/timeline";
import type { Project } from "../types/project";
import type { IrisShape } from "../types/transitions";

export const IRIS_SHAPES = ["circle", "rectangle", "diamond", "star"] as const;
const irisShapes = new Set<string>(IRIS_SHAPES);
const starInradiusRatio = (0.5 * Math.sin(Math.PI / 5)) / Math.sqrt(1.25 - Math.cos(Math.PI / 5));

export function isIrisShape(value: unknown): value is IrisShape {
  return typeof value === "string" && irisShapes.has(value);
}

/** Clear outside the vector aperture on the existing effects surface, without pixel readback or a scratch bitmap. */
export function applyIrisMaskToContext(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  params: Record<string, unknown>,
  width: number,
  height: number,
): boolean {
  if (!isIrisShape(params.irisShape) || typeof params.progress !== "number" || !Number.isFinite(params.progress) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const progress = Math.max(0, Math.min(1, params.progress));
  if (progress === 1) return true;
  const centerX = typeof params.centerX === "number" && Number.isFinite(params.centerX) ? params.centerX : 0.5;
  const centerY = typeof params.centerY === "number" && Number.isFinite(params.centerY) ? params.centerY : 0.5;
  const cx = centerX * width, cy = centerY * height;
  const dx = Math.max(Math.abs(cx), Math.abs(width - cx));
  const dy = Math.max(Math.abs(cy), Math.abs(height - cy));
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (progress === 0) { ctx.clearRect(0, 0, width, height); return true; }
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    if (params.irisShape === "circle") {
      const radius = Math.hypot(dx, dy) * progress;
      ctx.moveTo(cx + radius, cy);
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    } else if (params.irisShape === "rectangle") {
      ctx.rect(cx - dx * progress, cy - dy * progress, dx * progress * 2, dy * progress * 2);
    } else if (params.irisShape === "diamond") {
      const radius = (dx + dy) * progress;
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx + radius, cy); ctx.lineTo(cx, cy + radius); ctx.lineTo(cx - radius, cy);
      ctx.closePath();
    } else {
      // The star's edge inradius covers the farthest frame corner at completion.
      const radius = Math.hypot(dx, dy) * progress / starInradiusRatio;
      for (let index = 0; index < 10; index++) {
        const angle = -Math.PI / 2 + index * Math.PI / 5;
        const distance = radius * (index % 2 === 0 ? 1 : 0.5);
        const x = cx + Math.cos(angle) * distance, y = cy + Math.sin(angle) * distance;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.clip("evenodd");
    ctx.clearRect(0, 0, width, height);
    return true;
  } finally { ctx.restore(); }
}

/** Upgrade the old generated iris zoom/fade keys, retaining every unrelated manual key. */
export function normalizeLegacyIrisKeyframes(keyframes: Keyframe[]): Keyframe[] {
  if (!keyframes.some(key => typeof key?.id === "string" && /^kf-(entry|exit)-(iris-|scale-)/.test(key.id))) return keyframes;
  const replacements: Keyframe[] = [];
  const removed = new Set<Keyframe>();
  for (const side of ["entry", "exit"] as const) {
    for (const irisShape of IRIS_SHAPES) {
      const prefix = `kf-${side}-iris-${irisShape}-`;
      let group = keyframes.filter(key => typeof key?.id === "string" && key.id.startsWith(prefix) && ["scale.x", "scale.y", "opacity"].includes(key.property));
      // Very old unnamed iris presets can only be identified as the original circle.
      if (group.length === 0 && irisShape === "circle") {
        const unnamed = keyframes.filter(key => new RegExp(`^kf-${side}-(scale|opacity)-[0-3]$`).test(key.id));
        const edge = side === "entry" ? Math.min(...unnamed.map(key => key.time)) : Math.max(...unnamed.map(key => key.time));
        if (unnamed.some(key => key.property === "scale.x" && key.time === edge && key.value === 0) &&
          unnamed.some(key => key.property === "opacity" && key.time === edge && key.value === 0.5)) group = unnamed;
      }
      const scales = group.filter(key => key.property === "scale.x" && typeof key.value === "number" && Number.isFinite(key.value) && Number.isFinite(key.time)).sort((a, b) => a.time - b.time);
      if (scales.length < 2 || scales[0].time === scales.at(-1)!.time) continue;
      const fullScale = (side === "entry" ? scales.at(-1)! : scales[0]).value as number;
      scales.forEach((key, index) => replacements.push({
        ...key, id: `${prefix}reveal-${index}`, property: `effect.iris-${irisShape}`,
        value: fullScale !== 0 ? Math.max(0, Math.min(1, (key.value as number) / fullScale)) : (side === "entry" ? index / (scales.length - 1) : 1 - index / (scales.length - 1)),
      }));
      for (const key of group) removed.add(key);
    }
  }
  return removed.size ? [...keyframes.filter(key => !removed.has(key)), ...replacements] : keyframes;
}

export function normalizeProjectIrisAnimations(project: Project): Project {
  if (!Array.isArray(project.timeline?.tracks)) return project;
  const normalizeClips = <T extends { readonly keyframes?: Keyframe[] }>(clips: T[] | undefined): T[] | undefined => {
    if (!Array.isArray(clips)) return clips;
    let changed = false;
    const next = clips.map(clip => {
      if (!Array.isArray(clip.keyframes) || !clip.keyframes.length) return clip;
      const keyframes = normalizeLegacyIrisKeyframes(clip.keyframes);
      if (keyframes === clip.keyframes) return clip;
      changed = true; return { ...clip, keyframes };
    });
    return changed ? next : clips;
  };
  let tracksChanged = false;
  const tracks = project.timeline.tracks.map(track => {
    const clips = normalizeClips(track.clips)!;
    if (clips === track.clips) return track;
    tracksChanged = true; return { ...track, clips };
  });
  const textClips = normalizeClips(project.textClips), shapeClips = normalizeClips(project.shapeClips);
  const svgClips = normalizeClips(project.svgClips), stickerClips = normalizeClips(project.stickerClips);
  if (!tracksChanged && textClips === project.textClips && shapeClips === project.shapeClips && svgClips === project.svgClips && stickerClips === project.stickerClips) return project;
  return { ...project, timeline: tracksChanged ? { ...project.timeline, tracks } : project.timeline,
    ...(textClips !== project.textClips ? { textClips } : {}), ...(shapeClips !== project.shapeClips ? { shapeClips } : {}),
    ...(svgClips !== project.svgClips ? { svgClips } : {}), ...(stickerClips !== project.stickerClips ? { stickerClips } : {}) };
}
