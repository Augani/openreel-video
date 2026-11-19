import { PRO_EFFECT_NEUTRAL_PARAMS, planarCornersAt,
  type Clip, type Effect, type Keyframe, type MediaItem, type PlanarTrackData, type Project,
} from "@openreel/core";
import { effectInstanceKeyframeProperty } from "@openreel/core/video/effect-instance-keyframes";
import { useProjectStore } from "../stores/project-store";
import { EditingSession } from "./agent/editing-session";
import { assertEditable, compactLinearKeys, projectTrackedPoint, replaceTarget } from "./motion-tracking-edit";
import { motionTrackingSourceSignature } from "./motion-tracking-source";

const PLANAR_ANALYSIS = "workspacePlanarTrackAnalysis";
export const PLANAR_APPLICATION = "workspacePlanarTrackApplication";
export interface PlanarTrackAnalysis { version: 1; signature: string; data: PlanarTrackData }
export interface PlanarApplyOptions { smoothing: number }
interface PlanarApplication { version: 1; sourceClipId: string; effectId: string; effectCreated: boolean; generatedIds: string[]; options: PlanarApplyOptions }

const PARAM_RANGE = { min: -100, max: 200 } as const;
export const planarEffectId = (sourceId: string): string => `planar-pin-${sourceId}`;

function validAnalysis(value: PlanarTrackAnalysis | undefined, clipId: string): value is PlanarTrackAnalysis {
  const d = value?.data;
  return value?.version === 1 && typeof value.signature === "string" && d?.version === 1 && d.clipId === clipId
    && Number.isFinite(d.frameRate) && d.frameRate > 0 && Array.isArray(d.keyframes) && Array.isArray(d.confidence)
    && Array.isArray(d.lostFrames) && Array.isArray(d.manualFrames) && d.anchorCorners?.length === 8
    && d.keyframes.every((k, i, all) => Number.isInteger(k.frame) && k.frame >= 0 && (i === 0 || k.frame > all[i - 1].frame)
      && k.corners.length === 8 && k.corners.every(Number.isFinite));
}

function sourceOf(project: Project, clipId: string): { clip: Clip; media: MediaItem } | null {
  const clip = project.timeline.tracks.flatMap(track => track.clips).find(c => c.id === clipId);
  const media = project.mediaLibrary.items.find(item => item.id === clip?.mediaId);
  return clip && media ? { clip, media } : null;
}

export function readPlanarTrackAnalysis(clipId: string): PlanarTrackAnalysis | null {
  const project = useProjectStore.getState().project, source = sourceOf(project, clipId);
  const value = source?.clip.metadata?.[PLANAR_ANALYSIS] as PlanarTrackAnalysis | undefined;
  return source && validAnalysis(value, clipId) && value.signature === motionTrackingSourceSignature(project, source.clip, source.media) ? value : null;
}

export function readPlanarTrackApplication(targetId: string): PlanarApplication | null {
  const clip = useProjectStore.getState().project.timeline.tracks.flatMap(track => track.clips).find(c => c.id === targetId);
  const value = clip?.metadata?.[PLANAR_APPLICATION] as PlanarApplication | undefined;
  return value?.version === 1 && Array.isArray(value.generatedIds) ? value : null;
}

/** Corner-pin keyframes (percent of the canvas) for the target, one `fx:` track per corner coordinate. Pure. */
function computeApplication(project: Project, source: Clip, media: MediaItem, target: Clip, data: PlanarTrackData, options: PlanarApplyOptions): { effects: Effect[]; keyframes: Keyframe[]; metadata: Clip["metadata"] } {
  if (!data.keyframes.length) throw new Error("The planar track is empty");
  if (!Number.isFinite(options.smoothing)) throw new Error("Choose valid tracking options");
  const start = Math.max(source.startTime, target.startTime), end = Math.min(source.startTime + source.duration, target.startTime + target.duration);
  if (end <= start) throw new Error("The source and target clips do not overlap");
  const fps = data.frameRate, radius = Math.max(0, Math.min(10, Math.round(options.smoothing)));
  const smoothed = data.keyframes.map((key, i) => {
    const near = data.keyframes.slice(Math.max(0, i - radius), Math.min(data.keyframes.length, i + radius + 1));
    return { frame: key.frame, corners: key.corners.map((_, c) => near.reduce((sum, n) => sum + n.corners[c], 0) / near.length) };
  });
  const view: PlanarTrackData = { ...data, keyframes: smoothed };
  const edgeFrame = (time: number) => (time - source.startTime) * fps;
  const frames = [edgeFrame(start), ...smoothed.map(k => k.frame).filter(f => source.startTime + f / fps > start && source.startTime + f / fps < end), edgeFrame(end)];
  const effectId = planarEffectId(source.id), previous = target.metadata?.[PLANAR_APPLICATION] as PlanarApplication | undefined;
  const generated = new Set(previous?.generatedIds ?? []);
  const lanes = new Map<string, Keyframe[]>();
  frames.forEach((frame, index) => {
    const at = planarCornersAt(view, frame);
    if (!at) return;
    const time = source.startTime + frame / fps;
    for (let c = 0; c < 4; c++) {
      const p = projectTrackedPoint(project, source, media, { x: at.corners[c * 2], y: at.corners[c * 2 + 1] }, frame / fps);
      const values = [p.x / project.settings.width * 100, p.y / project.settings.height * 100];
      (["x", "y"] as const).forEach((axis, k) => {
        const param = `${axis}${c}`, value = Math.max(PARAM_RANGE.min, Math.min(PARAM_RANGE.max, values[k]));
        if (!Number.isFinite(value)) throw new Error("Tracking produced an invalid corner");
        const lane = lanes.get(param) ?? [];
        lane.push({ id: `planar-${data.trackId}-${effectId}-${param}-${index}`, property: effectInstanceKeyframeProperty(effectId, param), time: time - target.startTime, value, easing: "linear" });
        lanes.set(param, lane);
      });
    }
  });
  const fresh = [...lanes.values()].flatMap(compactLinearKeys);
  const existing = target.effects.find(e => e.id === effectId);
  const effect: Effect = existing ?? { id: effectId, type: "corner-pin", params: { ...PRO_EFFECT_NEUTRAL_PARAMS["corner-pin"] }, enabled: true };
  const effects = existing ? target.effects.map(e => e.id === effectId ? { ...e, enabled: true } : e) : [...target.effects, effect];
  const application: PlanarApplication = { version: 1, sourceClipId: source.id, effectId, effectCreated: previous?.effectCreated ?? !existing, generatedIds: fresh.map(k => k.id), options };
  return { effects, keyframes: [...target.keyframes.filter(k => !generated.has(k.id)), ...fresh], metadata: { ...target.metadata, [PLANAR_APPLICATION]: application } };
}

function targets(project: Project, sourceId: string): Clip[] {
  return project.timeline.tracks.flatMap(track => track.clips).filter(c => (c.metadata?.[PLANAR_APPLICATION] as PlanarApplication | undefined)?.sourceClipId === sourceId);
}

/** Save an analysis on the source clip; every corner pin attached to it follows the new path in the same undo step. */
export async function persistPlanarTrackAnalysis(projectId: string, analysis: PlanarTrackAnalysis, signal?: AbortSignal, label = "Track planar surface"): Promise<void> {
  const session = new EditingSession(signal), transaction = session.beginTransaction(), project = session.getProject();
  const source = sourceOf(project, analysis.data.clipId);
  if (project.id !== projectId || !source || !validAnalysis(analysis, source.clip.id) || motionTrackingSourceSignature(project, source.clip, source.media) !== analysis.signature) throw new Error("The tracking source changed; analyze it again");
  assertEditable(project, source.clip);
  let next = replaceTarget(project, source.clip.id, { keyframes: source.clip.keyframes, metadata: { ...source.clip.metadata, [PLANAR_ANALYSIS]: structuredClone(analysis) } });
  for (const target of targets(next, source.clip.id)) {
    const application = target.metadata?.[PLANAR_APPLICATION] as PlanarApplication;
    if (!next.timeline.tracks.some(t => t.id === target.trackId && !t.locked)) continue;
    try { next = replaceTarget(next, target.id, computeApplication(next, source.clip, source.media, target, analysis.data, application.options)); } catch { /* a target that cannot follow keeps its last pin */ }
  }
  session.replaceDraft(next);
  await session.commitTransaction(transaction, label);
}

export async function applyPlanarTrack(sourceId: string, targetId: string, options: PlanarApplyOptions): Promise<void> {
  const session = new EditingSession(), transaction = session.beginTransaction(), project = session.getProject();
  const source = sourceOf(project, sourceId), target = project.timeline.tracks.flatMap(track => track.clips).find(c => c.id === targetId);
  const analysis = source?.clip.metadata?.[PLANAR_ANALYSIS] as PlanarTrackAnalysis | undefined;
  if (!source || !target || target.id === source.clip.id || !validAnalysis(analysis, sourceId) || analysis.signature !== motionTrackingSourceSignature(project, source.clip, source.media)) throw new Error("Track the current source and choose a different clip to pin");
  assertEditable(project, target);
  session.replaceDraft(replaceTarget(project, targetId, computeApplication(project, source.clip, source.media, target, analysis.data, options)));
  await session.commitTransaction(transaction, "Pin to tracked surface");
}

/** Detach the track: its keyframes go, and the Corner Pin effect goes too when this feature created it. */
export async function removePlanarTrack(targetId: string): Promise<void> {
  const session = new EditingSession(), transaction = session.beginTransaction(), project = session.getProject();
  const target = project.timeline.tracks.flatMap(track => track.clips).find(c => c.id === targetId);
  const application = target?.metadata?.[PLANAR_APPLICATION] as PlanarApplication | undefined;
  if (!target || application?.version !== 1) return;
  assertEditable(project, target);
  const generated = new Set(application.generatedIds), metadata = { ...target.metadata };
  delete metadata[PLANAR_APPLICATION];
  const effects = application.effectCreated ? target.effects.filter(e => e.id !== application.effectId) : target.effects;
  session.replaceDraft(replaceTarget(project, targetId, { effects, keyframes: target.keyframes.filter(k => !generated.has(k.id)), metadata }));
  await session.commitTransaction(transaction, "Remove planar tracking");
}
