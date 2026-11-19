import { interpretedDisplaySize, keyframeEngine, resolveCanvasFitDimensions, type Clip, type ClipMetadata, type Effect, type Keyframe, type MediaItem, type Project, type TrackingData, type Transform } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { EditingSession } from "./agent/editing-session";
import { motionTrackingSourceSignature } from "./motion-tracking-source";

const TRACKING_ANALYSIS = "workspaceMotionTrackingAnalysis";
export const TRACKING_APPLICATION = "workspaceMotionTrackingApplication";
export interface MotionTrackingAnalysis { version: 1; signature: string; data: TrackingData }
export interface MotionTrackingApplyOptions { offset: { x: number; y: number }; applyScale: boolean; applyRotation: boolean; smoothing: number; mode: "follow" | "pin" }
interface Application { version: 1; sourceClipId: string; generatedIds: string[]; replacedKeys: Keyframe[]; options: MotionTrackingApplyOptions }
type Target = Pick<Clip, "id" | "trackId" | "startTime" | "duration" | "keyframes" | "transform"> & { metadata?: ClipMetadata };

export function getMotionTrackingTarget(project: Project, id: string): { clip: Target; normalized: boolean } | null {
  const regular = project.timeline.tracks.flatMap(track => track.clips).find(clip => clip.id === id);
  if (regular) {
    const track = project.timeline.tracks.find(track => track.id === regular.trackId);
    const media = project.mediaLibrary.items.find(item => item.id === regular.mediaId);
    return track?.type !== "audio" && media?.type !== "audio" ? { clip: regular, normalized: false } : null;
  }
  const overlay = project.textClips?.find(clip => clip.id === id) ?? project.shapeClips?.find(clip => clip.id === id)
    ?? project.svgClips?.find(clip => clip.id === id) ?? project.stickerClips?.find(clip => clip.id === id);
  return overlay ? { clip: overlay, normalized: true } : null;
}

function validAnalysis(value: MotionTrackingAnalysis | undefined, clipId: string): value is MotionTrackingAnalysis {
  const data = value?.data;
  return value?.version === 1 && typeof value.signature === "string" && data?.clipId === clipId
    && Number.isFinite(data.frameRate) && data.frameRate > 0 && Array.isArray(data.keyframes)
    && Array.isArray(data.lostFrames) && Array.isArray(data.confidence)
    && data.confidence.every(value => typeof value === "number" && Number.isFinite(value))
    && data.lostFrames.every(frame => Number.isInteger(frame))
    && (data.manualFrames === undefined || (Array.isArray(data.manualFrames) && data.manualFrames.every(frame => Number.isInteger(frame))))
    && (data.states === undefined || (Array.isArray(data.states) && data.states.length === data.keyframes.length && data.states.every(state => state === "tracked" || state === "reacquired" || state === "predicted")))
    && data.keyframes.every((key, index, frames) => Number.isInteger(key.frame) && key.frame >= 0
      && (index === 0 || key.frame > frames[index - 1].frame)
      && Number.isFinite(key.position?.x) && Number.isFinite(key.position?.y)
      && (key.scale === undefined || Number.isFinite(key.scale) && key.scale > 0)
      && (key.rotation === undefined || Number.isFinite(key.rotation)));
}

export function readMotionTrackingAnalysis(clipId: string): MotionTrackingAnalysis | null {
  const project = useProjectStore.getState().project;
  const target = getMotionTrackingTarget(project, clipId);
  const source = project.timeline.tracks.flatMap(track => track.clips).find(clip => clip.id === clipId);
  const media = project.mediaLibrary.items.find(item => item.id === source?.mediaId);
  const value = target?.clip.metadata?.[TRACKING_ANALYSIS] as MotionTrackingAnalysis | undefined;
  return validAnalysis(value, clipId) && source && media && value.signature === motionTrackingSourceSignature(project, source, media) ? value : null;
}

export function readMotionTrackingApplication(targetId: string): Application | null {
  const value = getMotionTrackingTarget(useProjectStore.getState().project, targetId)?.clip.metadata?.[TRACKING_APPLICATION] as Application | undefined;
  return value?.version === 1 && Array.isArray(value.generatedIds) && Array.isArray(value.replacedKeys) ? value : null;
}

export function replaceTarget(project: Project, id: string, changes: Pick<Target, "keyframes" | "metadata"> & { effects?: Effect[] }): Project {
  return { ...project,
    timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => ({ ...track, clips: track.clips.map(clip => clip.id === id ? { ...clip, ...changes } : clip) })) },
    textClips: project.textClips?.map(clip => clip.id === id ? { ...clip, ...changes } : clip),
    shapeClips: project.shapeClips?.map(clip => clip.id === id ? { ...clip, ...changes } : clip),
    svgClips: project.svgClips?.map(clip => clip.id === id ? { ...clip, ...changes } : clip),
    stickerClips: project.stickerClips?.map(clip => clip.id === id ? { ...clip, ...changes } : clip),
  };
}

export function assertEditable(project: Project, target: Target) {
  if (!project.timeline.tracks.some(track => track.id === target.trackId && !track.locked)
    || useUIStore.getState().exportState.isExporting || useUIStore.getState().effectApplicationClipId !== null || useTimelineStore.getState().playbackLockedReason) throw new Error("Unlock the target and finish exporting before applying tracking");
}

export async function persistMotionTrackingAnalysis(projectId: string, analysis: MotionTrackingAnalysis, signal?: AbortSignal, label = "Analyze motion tracking"): Promise<void> {
  const session = new EditingSession(signal), transaction = session.beginTransaction(), project = session.getProject();
  const clip = project.timeline.tracks.flatMap(track => track.clips).find(clip => clip.id === analysis.data.clipId);
  const media = project.mediaLibrary.items.find(item => item.id === clip?.mediaId);
  if (project.id !== projectId || !clip || !media || !validAnalysis(analysis, clip.id) || motionTrackingSourceSignature(project, clip, media) !== analysis.signature) throw new Error("The tracking source changed; analyze it again");
  assertEditable(project, clip);
  let next = replaceTarget(project, clip.id, { keyframes: clip.keyframes, metadata: { ...clip.metadata, [TRACKING_ANALYSIS]: structuredClone(analysis) } });
  // Anything already attached to this path follows the new path inside the same undo step.
  for (const id of attachedTargetIds(next, clip.id)) {
    const target = getMotionTrackingTarget(next, id), application = target?.clip.metadata?.[TRACKING_APPLICATION] as Application | undefined;
    if (!target || !application || !project.timeline.tracks.some(track => track.id === target.clip.trackId && !track.locked)) continue;
    try { next = replaceTarget(next, id, computeApplication(next, clip, media, target, analysis, application.options)); } catch { /* leave a target that cannot follow as it was */ }
  }
  session.replaceDraft(next);
  await session.commitTransaction(transaction, label);
}

function attachedTargetIds(project: Project, sourceId: string): string[] {
  const clips: Array<{ id: string; metadata?: ClipMetadata }> = [...project.timeline.tracks.flatMap(track => track.clips), ...(project.textClips ?? []),
    ...(project.shapeClips ?? []), ...(project.svgClips ?? []), ...(project.stickerClips ?? [])];
  return clips.filter(clip => (clip.metadata?.[TRACKING_APPLICATION] as Application | undefined)?.sourceClipId === sourceId).map(clip => clip.id);
}

function originalKeys(target: Target): Keyframe[] {
  const application = target.metadata?.[TRACKING_APPLICATION] as Application | undefined;
  if (application?.version !== 1) return target.keyframes;
  const generated = new Set(application.generatedIds);
  return [...target.keyframes.filter(key => !generated.has(key.id)), ...application.replacedKeys];
}

function animatedTransform(target: Target, time: number): Transform {
  const base = target.transform, keys = originalKeys(target);
  const sample = (property: string, fallback: number) => {
    const value = keyframeEngine.getValueAtTime(keyframeEngine.getKeyframesForProperty(keys, property), time).value;
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  return { ...base, position: { x: sample("position.x", base.position.x), y: sample("position.y", base.position.y) },
    scale: { x: sample("scale.x", base.scale.x), y: sample("scale.y", base.scale.y) }, rotation: sample("rotation", base.rotation) };
}

/** A tracked source-pixel point, mapped through the source clip's animated transform onto the canvas (pixels from the top left). */
export function projectTrackedPoint(project: Project, source: Clip, media: MediaItem, position: { x: number; y: number }, localTime: number): { x: number; y: number; transform: Transform } {
  const transform = animatedTransform(source, localTime), crop = transform.crop;
  // Tracker samples are in stored pixels; the render fits the display shape (pixel aspect applied to the width).
  const display = interpretedDisplaySize(media), parX = display.width / media.metadata.width;
  const width = display.width * (crop?.width ?? 1), height = display.height * (crop?.height ?? 1);
  const fitted = resolveCanvasFitDimensions(transform.fitMode, width, height, project.settings.width, project.settings.height);
  const x = (position.x * parX - (crop?.x ?? 0) * display.width - width * transform.anchor.x) * fitted.width / width * transform.scale.x;
  const y = (position.y - (crop?.y ?? 0) * media.metadata.height - height * transform.anchor.y) * fitted.height / height * transform.scale.y;
  const radians = transform.rotation * Math.PI / 180;
  return { x: project.settings.width / 2 + transform.position.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: project.settings.height / 2 + transform.position.y + x * Math.sin(radians) + y * Math.cos(radians), transform };
}

/** Remove only numerically collinear points; retain the authored sampled path. */
export function compactLinearKeys(keys: Keyframe[]): Keyframe[] {
  const output: Keyframe[] = [];
  for (const key of keys) {
    while (output.length > 1) {
      const a = output[output.length - 2], b = output[output.length - 1];
      const predicted = Number(a.value) + (Number(key.value) - Number(a.value)) * (b.time - a.time) / (key.time - a.time);
      if (Math.abs(predicted - Number(b.value)) > 1e-8) break;
      output.pop();
    }
    output.push(key);
  }
  return output;
}

/** Pure: the target's keyframes and metadata once `analysis` is applied to it. Throws a user-facing Error when it cannot be. */
function computeApplication(project: Project, source: Clip, media: MediaItem, target: { clip: Target; normalized: boolean }, analysis: MotionTrackingAnalysis, options: MotionTrackingApplyOptions): Pick<Target, "keyframes" | "metadata"> {
  const sourceId = source.id;
  if (![options.offset.x, options.offset.y, options.smoothing].every(Number.isFinite)
    || !["follow", "pin"].includes(options.mode)) throw new Error("Choose valid tracking options");
  const frames = analysis.data.keyframes;
  if (!frames.length) throw new Error("The tracking path is empty");
  const overlapStart = Math.max(source.startTime, target.clip.startTime), overlapEnd = Math.min(source.startTime + source.duration, target.clip.startTime + target.clip.duration);
  if (overlapEnd <= overlapStart) throw new Error("The source and target clips do not overlap");
  const radius = Math.max(0, Math.min(10, Math.round(options.smoothing)));
  const samples = frames.map((frame, index) => {
    const neighborhood = frames.slice(Math.max(0, index - radius), Math.min(frames.length, index + radius + 1));
    return { ...frame, position: { x: neighborhood.reduce((sum, key) => sum + key.position.x, 0) / neighborhood.length,
      y: neighborhood.reduce((sum, key) => sum + key.position.y, 0) / neighborhood.length } };
  });
  const atTime = (localTime: number) => {
    const frame = localTime * analysis.data.frameRate;
    let index = Math.max(0, samples.findIndex(sample => sample.frame >= frame));
    if (samples[samples.length - 1].frame < frame) index = samples.length - 1;
    const next = samples[index], previous = samples[Math.max(0, index - 1)], span = next.frame - previous.frame;
    const fraction = span > 0 ? Math.min(1, Math.max(0, (frame - previous.frame) / span)) : 0;
    return { frame, position: { x: previous.position.x + (next.position.x - previous.position.x) * fraction,
      y: previous.position.y + (next.position.y - previous.position.y) * fraction },
      scale: (previous.scale ?? 1) + ((next.scale ?? 1) - (previous.scale ?? 1)) * fraction,
      rotation: (previous.rotation ?? 0) + ((next.rotation ?? 0) - (previous.rotation ?? 0)) * fraction };
  };
  const selected = [atTime(overlapStart - source.startTime), ...samples.filter(sample => {
    const time = source.startTime + sample.frame / analysis.data.frameRate;
    return time > overlapStart && time < overlapEnd;
  }), atTime(overlapEnd - source.startTime)];
  const projectPoint = (sample: typeof selected[number]) => projectTrackedPoint(project, source, media, sample.position, sample.frame / analysis.data.frameRate);
  const first = selected[0], anchor = projectPoint(first), base = animatedTransform(target.clip, overlapStart - target.clip.startTime);
  const controlled = new Set(["position.x", "position.y", ...(options.applyScale ? ["scale.x", "scale.y"] : []), ...(options.applyRotation ? ["rotation"] : [])]);
  const localStart = overlapStart - target.clip.startTime, localEnd = overlapEnd - target.clip.startTime;
  const replaces = (key: Keyframe) => controlled.has(key.property) && key.time >= localStart && key.time <= localEnd;
  const baseKeys = originalKeys(target.clip), replacedKeys = baseKeys.filter(replaces);
  const properties = new Map<string, Keyframe[]>();
  for (const [index, sample] of selected.entries()) {
    const point = projectPoint(sample), deltaX = point.x - anchor.x, deltaY = point.y - anchor.y;
    const divisorX = target.normalized ? project.settings.width : 1, divisorY = target.normalized ? project.settings.height : 1;
    const values: Record<string, number> = {
      "position.x": options.mode === "pin" ? (point.x - (target.normalized ? 0 : project.settings.width / 2) + options.offset.x) / divisorX : base.position.x + (deltaX + options.offset.x) / divisorX,
      "position.y": options.mode === "pin" ? (point.y - (target.normalized ? 0 : project.settings.height / 2) + options.offset.y) / divisorY : base.position.y + (deltaY + options.offset.y) / divisorY,
      "scale.x": base.scale.x * (sample.scale ?? 1) / (first.scale ?? 1) * (Math.abs(anchor.transform.scale.x) < .000001 ? 1 : point.transform.scale.x / anchor.transform.scale.x),
      "scale.y": base.scale.y * (sample.scale ?? 1) / (first.scale ?? 1) * (Math.abs(anchor.transform.scale.y) < .000001 ? 1 : point.transform.scale.y / anchor.transform.scale.y),
      rotation: base.rotation + (sample.rotation ?? 0) - (first.rotation ?? 0) + point.transform.rotation - anchor.transform.rotation,
    };
    for (const property of controlled) {
      const value = values[property];
      if (!Number.isFinite(value)) throw new Error("Tracking produced an invalid transform");
      const list = properties.get(property) ?? [];
      list.push({ id: `tracking-${analysis.data.trackId}-${property}-${index}`, property, time: source.startTime + sample.frame / analysis.data.frameRate - target.clip.startTime, value, easing: "linear" });
      properties.set(property, list);
    }
  }
  const generated = [...properties.values()].flatMap(compactLinearKeys);
  const application: Application = { version: 1, sourceClipId: sourceId, options, generatedIds: generated.map(key => key.id), replacedKeys };
  // Previously replaced channels that are no longer controlled are restored.
  const remaining = baseKeys.filter(key => !replaces(key));
  return { keyframes: [...remaining, ...generated], metadata: { ...target.clip.metadata, [TRACKING_APPLICATION]: application } };
}

export async function applyMotionTracking(sourceId: string, targetId: string, options: MotionTrackingApplyOptions): Promise<void> {
  const session = new EditingSession(), transaction = session.beginTransaction(), project = session.getProject();
  const source = project.timeline.tracks.flatMap(track => track.clips).find(clip => clip.id === sourceId);
  const media = project.mediaLibrary.items.find(item => item.id === source?.mediaId);
  const target = getMotionTrackingTarget(project, targetId);
  const analysis = source?.metadata?.[TRACKING_ANALYSIS] as MotionTrackingAnalysis | undefined;
  if (!source || !media || !target || !validAnalysis(analysis, sourceId) || analysis.signature !== motionTrackingSourceSignature(project, source, media)) throw new Error("Analyze the current source before applying tracking");
  assertEditable(project, target.clip);
  session.replaceDraft(replaceTarget(project, targetId, computeApplication(project, source, media, target, analysis, options)));
  await session.commitTransaction(transaction, "Apply motion tracking");
}

export async function removeMotionTracking(targetId: string): Promise<void> {
  const session = new EditingSession(), transaction = session.beginTransaction(), project = session.getProject();
  const target = getMotionTrackingTarget(project, targetId);
  if (!target || !target.clip.metadata?.[TRACKING_APPLICATION]) return;
  assertEditable(project, target.clip);
  const metadata = { ...target.clip.metadata }; delete metadata[TRACKING_APPLICATION];
  session.replaceDraft(replaceTarget(project, targetId, { keyframes: originalKeys(target.clip), metadata }));
  await session.commitTransaction(transaction, "Remove motion tracking");
}
