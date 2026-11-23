import {
  PRO_EFFECT_NEUTRAL_PARAMS, interpretedDisplaySize, planarCornersAt, resolveCanvasFitDimensions,
  type Clip, type Effect, type Keyframe, type MediaItem, type PlanarTrackData, type Project,
} from "@openreel/core";
import { effectInstanceKeyframeProperty } from "@openreel/core/video/effect-instance-keyframes";
import type { Mask, MaskKeyframe } from "@openreel/core/video/mask-engine";
import { compactLinearKeys, projectTrackedPoint, replaceTarget } from "./motion-tracking-edit";

/**
 * Pure maths for "apply a planar track to a clip". A tracked surface becomes, on the target clip, one of:
 *  - corner-pin: a Corner Pin effect whose four corners are keyframed to the surface (perspective-correct);
 *  - mask: a four-point mask whose path is keyframed to the surface (grade, blur or key only that surface);
 *  - transform: Position, Scale and Rotation keyframes that fit the clip onto the surface as a screen
 *    replacement (similarity fit: the clip keeps its own shape, so use Corner Pin when perspective matters).
 * Everything is derived from the saved analysis, so re-tracking re-derives the keyframes. No stores, no DOM.
 */

export const PLANAR_APPLICATION = "workspacePlanarTrackApplication";
export type PlanarApplyMode = "corner-pin" | "mask" | "transform";
export interface PlanarApplyOptions { smoothing: number; mode?: PlanarApplyMode }
export interface PlanarApplication {
  version: 1;
  mode?: PlanarApplyMode;
  sourceClipId: string;
  effectId: string;
  effectCreated: boolean;
  maskId?: string;
  maskCreated?: boolean;
  generatedIds: string[];
  replacedKeys?: Keyframe[];
  options: PlanarApplyOptions;
}

const PARAM_RANGE = { min: -100, max: 200 } as const;
const TRANSFORM_PROPERTIES = ["position.x", "position.y", "scale.x", "scale.y", "rotation"] as const;
export const planarEffectId = (sourceId: string): string => `planar-pin-${sourceId}`;
export const planarMaskId = (sourceId: string, targetId: string): string => `planar-mask-${sourceId}-${targetId}`;
export const applicationMode = (application: Pick<PlanarApplication, "mode">): PlanarApplyMode => application.mode ?? "corner-pin";

function allClips(project: Project): Clip[] { return project.timeline.tracks.flatMap(track => track.clips); }
export function readApplication(project: Project, targetId: string): PlanarApplication | null {
  const value = allClips(project).find(c => c.id === targetId)?.metadata?.[PLANAR_APPLICATION] as PlanarApplication | undefined;
  return value?.version === 1 && Array.isArray(value.generatedIds) ? value : null;
}
export function applicationTargets(project: Project, sourceId: string): Clip[] {
  return allClips(project).filter(c => (c.metadata?.[PLANAR_APPLICATION] as PlanarApplication | undefined)?.sourceClipId === sourceId);
}

interface Sample { time: number; frame: number; /** composition pixels, TL TR BR BL */ corners: number[] }

/** The tracked quad in composition pixels at every sample inside the clips' overlap (plus the overlap edges), smoothed. */
export function projectedQuadSamples(project: Project, source: Clip, media: MediaItem, target: Pick<Clip, "startTime" | "duration">, data: PlanarTrackData, smoothing: number): Sample[] {
  if (!data.keyframes.length) throw new Error("The planar track is empty");
  if (!Number.isFinite(smoothing)) throw new Error("Choose valid tracking options");
  const start = Math.max(source.startTime, target.startTime), end = Math.min(source.startTime + source.duration, target.startTime + target.duration);
  if (end <= start) throw new Error("The source and target clips do not overlap");
  const fps = data.frameRate, radius = Math.max(0, Math.min(10, Math.round(smoothing)));
  const smoothed = data.keyframes.map((key, i) => {
    const near = data.keyframes.slice(Math.max(0, i - radius), Math.min(data.keyframes.length, i + radius + 1));
    return { frame: key.frame, corners: key.corners.map((_, c) => near.reduce((sum, n) => sum + n.corners[c], 0) / near.length) };
  });
  const view: PlanarTrackData = { ...data, keyframes: smoothed };
  const edge = (time: number) => (time - source.startTime) * fps;
  const frames = [edge(start), ...smoothed.map(k => k.frame).filter(f => source.startTime + f / fps > start && source.startTime + f / fps < end), edge(end)];
  return frames.map(frame => {
    const at = planarCornersAt(view, frame);
    if (!at) throw new Error("The planar track is empty");
    const corners: number[] = [];
    for (let c = 0; c < 4; c++) {
      const p = projectTrackedPoint(project, source, media, { x: at.corners[c * 2], y: at.corners[c * 2 + 1] }, frame / fps);
      corners.push(p.x, p.y);
    }
    if (!corners.every(Number.isFinite)) throw new Error("Tracking produced an invalid corner");
    return { time: source.startTime + frame / fps, frame, corners };
  });
}

function cornerPin(project: Project, source: Clip, media: MediaItem, target: Clip, data: PlanarTrackData, options: PlanarApplyOptions, previous: PlanarApplication | undefined): { effects: Effect[]; keyframes: Keyframe[]; application: PlanarApplication } {
  const samples = projectedQuadSamples(project, source, media, target, data, options.smoothing);
  const effectId = planarEffectId(source.id), generated = new Set(previous?.generatedIds ?? []), lanes = new Map<string, Keyframe[]>();
  samples.forEach((sample, index) => {
    for (let c = 0; c < 4; c++) (["x", "y"] as const).forEach((axis, k) => {
      const param = `${axis}${c}`, raw = sample.corners[c * 2 + k] / (k === 0 ? project.settings.width : project.settings.height) * 100;
      const lane = lanes.get(param) ?? [];
      lane.push({ id: `planar-${data.trackId}-${effectId}-${param}-${index}`, property: effectInstanceKeyframeProperty(effectId, param), time: sample.time - target.startTime, value: Math.max(PARAM_RANGE.min, Math.min(PARAM_RANGE.max, raw)), easing: "linear" });
      lanes.set(param, lane);
    });
  });
  const fresh = [...lanes.values()].flatMap(compactLinearKeys);
  const existing = target.effects.find(e => e.id === effectId);
  const effect: Effect = existing ?? { id: effectId, type: "corner-pin", params: { ...PRO_EFFECT_NEUTRAL_PARAMS["corner-pin"] }, enabled: true };
  const effects = existing ? target.effects.map(e => e.id === effectId ? { ...e, enabled: true } : e) : [...target.effects, effect];
  const created = previous && applicationMode(previous) === "corner-pin" ? previous.effectCreated : !existing;
  return { effects, keyframes: [...target.keyframes.filter(k => !generated.has(k.id)), ...fresh],
    application: { version: 1, mode: "corner-pin", sourceClipId: source.id, effectId, effectCreated: created, generatedIds: fresh.map(k => k.id), options } };
}

/** Fit of the clip's own frame onto the quad: centre, rotation (continuous) and the two scales, in canvas pixels / degrees. */
export function fitTransformToQuad(corners: readonly number[], fitted: { width: number; height: number }, anchor: { x: number; y: number }, previousRotation: number | null): { x: number; y: number; scaleX: number; scaleY: number; rotation: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = corners;
  const topAngle = Math.atan2(y1 - y0, x1 - x0), bottomAngle = Math.atan2(y2 - y3, x2 - x3);
  // Average the two edge directions as vectors so a 179/-179 degree pair does not cancel.
  let rotation = Math.atan2(Math.sin(topAngle) + Math.sin(bottomAngle), Math.cos(topAngle) + Math.cos(bottomAngle)) * 180 / Math.PI;
  if (previousRotation !== null) rotation += Math.round((previousRotation - rotation) / 360) * 360;
  const width = (Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x3, y2 - y3)) / 2, height = (Math.hypot(x3 - x0, y3 - y0) + Math.hypot(x2 - x1, y2 - y1)) / 2;
  const scaleX = width / fitted.width, scaleY = height / fitted.height;
  const cx = (x0 + x1 + x2 + x3) / 4, cy = (y0 + y1 + y2 + y3) / 4, r = rotation * Math.PI / 180;
  // The clip's anchor (its position point) sits at (anchor - 0.5) of the drawn frame away from the centre.
  const ox = (anchor.x - 0.5) * width, oy = (anchor.y - 0.5) * height;
  return { x: cx + ox * Math.cos(r) - oy * Math.sin(r), y: cy + ox * Math.sin(r) + oy * Math.cos(r), scaleX, scaleY, rotation };
}

function transformFit(project: Project, source: Clip, media: MediaItem, target: Clip, targetMedia: MediaItem | undefined, data: PlanarTrackData, options: PlanarApplyOptions, previous: PlanarApplication | undefined): { keyframes: Keyframe[]; application: PlanarApplication } {
  if (!targetMedia || targetMedia.type === "audio") throw new Error("Choose a picture or video clip to fit onto the surface");
  const samples = projectedQuadSamples(project, source, media, target, data, options.smoothing);
  const base = target.transform, crop = base.crop, display = interpretedDisplaySize(targetMedia);
  const fitted = resolveCanvasFitDimensions(base.fitMode, display.width * (crop?.width ?? 1), display.height * (crop?.height ?? 1), project.settings.width, project.settings.height);
  if (!(fitted.width > 0 && fitted.height > 0)) throw new Error("The target clip has no visible size");
  const localStart = samples[0].time - target.startTime, localEnd = samples[samples.length - 1].time - target.startTime;
  const originalKeys = previous && applicationMode(previous) === "transform"
    ? [...target.keyframes.filter(k => !previous.generatedIds.includes(k.id)), ...(previous.replacedKeys ?? [])] : target.keyframes;
  const controlled = new Set<string>(TRANSFORM_PROPERTIES);
  const replaced = originalKeys.filter(k => controlled.has(k.property) && k.time >= localStart - 1e-9 && k.time <= localEnd + 1e-9);
  const lanes = new Map<string, Keyframe[]>();
  let rotation: number | null = null;
  samples.forEach((sample, index) => {
    const fit = fitTransformToQuad(sample.corners, fitted, base.anchor, rotation);
    rotation = fit.rotation;
    const values: Record<string, number> = {
      "position.x": fit.x - project.settings.width / 2, "position.y": fit.y - project.settings.height / 2,
      "scale.x": fit.scaleX * Math.sign(base.scale.x || 1), "scale.y": fit.scaleY * Math.sign(base.scale.y || 1), rotation: fit.rotation,
    };
    for (const property of TRANSFORM_PROPERTIES) {
      if (!Number.isFinite(values[property])) throw new Error("Tracking produced an invalid transform");
      const lane = lanes.get(property) ?? [];
      lane.push({ id: `planar-tf-${data.trackId}-${source.id}-${property}-${index}`, property, time: sample.time - target.startTime, value: values[property], easing: "linear" });
      lanes.set(property, lane);
    }
  });
  const fresh = [...lanes.values()].flatMap(compactLinearKeys);
  const remaining = originalKeys.filter(k => !replaced.includes(k));
  return { keyframes: [...remaining, ...fresh], application: { version: 1, mode: "transform", sourceClipId: source.id, effectId: planarEffectId(source.id), effectCreated: false, generatedIds: fresh.map(k => k.id), replacedKeys: replaced, options } };
}

function maskFollow(project: Project, source: Clip, media: MediaItem, target: Clip, data: PlanarTrackData, options: PlanarApplyOptions, previous: PlanarApplication | undefined): { masks: Mask[]; application: PlanarApplication } {
  const samples = projectedQuadSamples(project, source, media, target, data, options.smoothing);
  const id = planarMaskId(source.id, target.id), all = project.masks ?? [], existing = all.find(m => m.id === id);
  const path = (corners: number[]) => ({ closed: true, points: [0, 1, 2, 3].map(i => ({ x: corners[i * 2] / project.settings.width, y: corners[i * 2 + 1] / project.settings.height })) });
  const keyframes: MaskKeyframe[] = samples.map((sample, index) => ({ id: `planar-mk-${data.trackId}-${index}`, time: sample.time, path: path(sample.corners), easing: "linear" }));
  const mask: Mask = { ...(existing ?? { id, clipId: target.id, type: "drawn", feathering: 0, inverted: false, expansion: 0, opacity: 1 }), path: path(samples[0].corners), keyframes };
  const created = previous && applicationMode(previous) === "mask" ? previous.maskCreated ?? !existing : !existing;
  return { masks: existing ? all.map(m => m.id === id ? mask : m) : [...all, mask],
    application: { version: 1, mode: "mask", sourceClipId: source.id, effectId: planarEffectId(source.id), effectCreated: false, maskId: id, maskCreated: created, generatedIds: [], options } };
}

/** Undo what an earlier application added to the target (effect, mask or transform keyframes), leaving the rest. */
export function stripApplication(project: Project, targetId: string, keepContainers = false): Project {
  const target = allClips(project).find(c => c.id === targetId), application = target?.metadata?.[PLANAR_APPLICATION] as PlanarApplication | undefined;
  if (!target || application?.version !== 1) return project;
  const mode = applicationMode(application), generated = new Set(application.generatedIds), metadata = { ...target.metadata };
  delete metadata[PLANAR_APPLICATION];
  let effects = target.effects, keyframes = target.keyframes.filter(k => !generated.has(k.id));
  if (mode === "corner-pin" && application.effectCreated && !keepContainers) effects = effects.filter(e => e.id !== application.effectId);
  if (mode === "transform") keyframes = [...keyframes, ...(application.replacedKeys ?? [])];
  let next = replaceTarget(project, targetId, { effects, keyframes, metadata });
  if (mode === "mask" && application.maskId && application.maskCreated && !keepContainers) next = { ...next, masks: (next.masks ?? []).filter(m => m.id !== application.maskId) };
  else if (mode === "mask" && application.maskId) next = { ...next, masks: (next.masks ?? []).map(m => m.id === application.maskId ? { ...m, keyframes: [] } : m) };
  return next;
}

/** The project with the track applied to the target in `options.mode` (default corner-pin). Throws a user-facing Error. */
export function applyTrackToProject(project: Project, source: Clip, media: MediaItem, targetId: string, data: PlanarTrackData, options: PlanarApplyOptions): Project {
  const mode = options.mode ?? "corner-pin";
  if (!["corner-pin", "mask", "transform"].includes(mode)) throw new Error("Choose a valid tracking option");
  const initial = allClips(project).find(c => c.id === targetId);
  if (!initial) throw new Error("Choose a clip to apply the track to");
  if (mode !== "mask" && initial.id === source.id) throw new Error("Choose a different clip to fit onto the surface");
  const previous = initial.metadata?.[PLANAR_APPLICATION] as PlanarApplication | undefined;
  const sameMode = previous?.version === 1 && applicationMode(previous) === mode;
  // Switching modes first removes the old result completely; refreshing the same mode keeps its effect or mask.
  const clean = previous?.version === 1 ? stripApplication(project, targetId, sameMode) : project;
  const target = allClips(clean).find(c => c.id === targetId)!;
  const prior = sameMode ? previous : undefined;
  // `strip` already removed generated keys of the previous application; the builders see the cleaned clip.
  const cleanPrior = prior ? { ...prior, generatedIds: [] } : undefined;
  if (mode === "corner-pin") {
    const built = cornerPin(clean, source, media, target, data, options, cleanPrior);
    return replaceTarget(clean, targetId, { effects: built.effects, keyframes: built.keyframes, metadata: { ...target.metadata, [PLANAR_APPLICATION]: built.application } });
  }
  if (mode === "transform") {
    const targetMedia = clean.mediaLibrary.items.find(item => item.id === target.mediaId);
    const built = transformFit(clean, source, media, target, targetMedia, data, options, undefined);
    return replaceTarget(clean, targetId, { keyframes: built.keyframes, metadata: { ...target.metadata, [PLANAR_APPLICATION]: built.application } });
  }
  const built = maskFollow(clean, source, media, target, data, options, prior);
  return { ...replaceTarget(clean, targetId, { keyframes: target.keyframes, metadata: { ...target.metadata, [PLANAR_APPLICATION]: built.application } }), masks: built.masks };
}
