import type { Clip, MediaItem, PlanarTrackData, Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { EditingSession } from "./agent/editing-session";
import { assertEditable, replaceTarget } from "./motion-tracking-edit";
import { motionTrackingSourceSignature } from "./motion-tracking-source";
import { PLANAR_APPLICATION, applicationTargets, applyTrackToProject, readApplication, stripApplication, type PlanarApplication, type PlanarApplyOptions } from "./planar-track-apply";

export { PLANAR_APPLICATION, planarEffectId, type PlanarApplication, type PlanarApplyMode, type PlanarApplyOptions } from "./planar-track-apply";

const PLANAR_ANALYSIS = "workspacePlanarTrackAnalysis";
export interface PlanarTrackAnalysis { version: 1; signature: string; data: PlanarTrackData }

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
  return readApplication(useProjectStore.getState().project, targetId);
}

/** Save an analysis on the source clip; every pin, mask or transform fitted to it follows the new path in the same undo step. */
export async function persistPlanarTrackAnalysis(projectId: string, analysis: PlanarTrackAnalysis, signal?: AbortSignal, label = "Track planar surface"): Promise<void> {
  const session = new EditingSession(signal), transaction = session.beginTransaction(), project = session.getProject();
  const source = sourceOf(project, analysis.data.clipId);
  if (project.id !== projectId || !source || !validAnalysis(analysis, source.clip.id) || motionTrackingSourceSignature(project, source.clip, source.media) !== analysis.signature) throw new Error("The tracking source changed; analyze it again");
  assertEditable(project, source.clip);
  let next = replaceTarget(project, source.clip.id, { keyframes: source.clip.keyframes, metadata: { ...source.clip.metadata, [PLANAR_ANALYSIS]: structuredClone(analysis) } });
  for (const target of applicationTargets(next, source.clip.id)) {
    const application = target.metadata?.[PLANAR_APPLICATION] as PlanarApplication;
    if (!next.timeline.tracks.some(t => t.id === target.trackId && !t.locked)) continue;
    const fresh = sourceOf(next, source.clip.id)!;
    try { next = applyTrackToProject(next, fresh.clip, fresh.media, target.id, analysis.data, application.options); } catch { /* a target that cannot follow keeps its last result */ }
  }
  session.replaceDraft(next);
  await session.commitTransaction(transaction, label);
}

export async function applyPlanarTrack(sourceId: string, targetId: string, options: PlanarApplyOptions): Promise<void> {
  const session = new EditingSession(), transaction = session.beginTransaction(), project = session.getProject();
  const source = sourceOf(project, sourceId), target = project.timeline.tracks.flatMap(track => track.clips).find(c => c.id === targetId);
  const analysis = source?.clip.metadata?.[PLANAR_ANALYSIS] as PlanarTrackAnalysis | undefined;
  if (!source || !target || !validAnalysis(analysis, sourceId) || analysis.signature !== motionTrackingSourceSignature(project, source.clip, source.media)) throw new Error("Track the current source and choose a clip to apply it to");
  assertEditable(project, target);
  const mode = options.mode ?? "corner-pin";
  session.replaceDraft(applyTrackToProject(project, source.clip, source.media, targetId, analysis.data, options));
  await session.commitTransaction(transaction, mode === "mask" ? "Mask follows tracked surface" : mode === "transform" ? "Fit clip to tracked surface" : "Pin to tracked surface");
}

/** Detach the track: its keyframes go, and the effect or mask goes too when this feature created it. */
export async function removePlanarTrack(targetId: string): Promise<void> {
  const session = new EditingSession(), transaction = session.beginTransaction(), project = session.getProject();
  const target = project.timeline.tracks.flatMap(track => track.clips).find(c => c.id === targetId);
  if (!target || !readApplication(project, targetId)) return;
  assertEditable(project, target);
  session.replaceDraft(stripApplication(project, targetId));
  await session.commitTransaction(transaction, "Remove planar tracking");
}
