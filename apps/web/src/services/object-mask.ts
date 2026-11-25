import { clipHasWarp, getSpeedEngine, maskPathAtTime, warpCompositionMap, type BezierPath, type BezierPoint, type Clip, type Mask, type MaskPoint, type MediaItem, type PointMap, type Project } from "@openreel/core";
import type { ObjectTrackFrame, RGBAFrame, SegmentPrompt } from "@openreel/core/video/object-mask/index";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { createObjectMaskEngine, type ObjectMaskEngine } from "./object-mask-engine";
import { createMotionTrackingSource } from "./motion-tracking-source";
import { projectTrackedPoint } from "./motion-tracking-edit";
import { commitMaskEdit, commitNewMask, maskOf } from "./mask-pen";
import { editClipMasks } from "./clip-masks";

/**
 * Object masks on the Program monitor: a click or brush stroke is segmented from the clip's decoded source frame
 * (classical GrabCut in a worker), Track Forward / Backward carries the outline through the footage with optical
 * flow and re-segmentation, and the result is an ordinary editable mask path with one keyframe per tracked frame.
 * Masks live in composition space; footage is analysed in source space, so every path is mapped through the clip's
 * (animated) transform at the frame it belongs to. The footage is the decoded picture as shot, so an object mask is
 * stored on that picture (`space: "source"`): on a clip with Warp Stabilizer the renderer moves it with each frame's
 * stabilizing warp, and clicks, brush strokes and anchors given on the stabilized monitor are mapped back first.
 */

/** Footage is read in the middle of each frame's interval, which is the picture the Program monitor shows for that frame. */
export const FRAME_MIDDLE = 0.5;

export interface Placement {
  project: Project;
  clip: Clip;
  media: MediaItem;
  fps: number;
}

export function placementOf(clipId: string): Placement {
  const project = useProjectStore.getState().project;
  const clip = project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
  const media = project.mediaLibrary.items.find((item) => item.id === clip?.mediaId);
  if (!clip || !media || (media.type !== "video" && media.type !== "image")) throw new Error("Select a video or image clip to mask");
  return { project, clip, media, fps: project.settings.frameRate };
}

/** Normalised source <-> normalised composition at a clip-local time (an affine map, sampled from the render maths). */
export function affineAt(place: Placement, localTime: number) {
  const { project, clip, media } = place;
  const at = (u: number, v: number) => {
    const p = projectTrackedPoint(project, clip, media, { x: u * media.metadata.width, y: v * media.metadata.height }, localTime);
    return { x: p.x / project.settings.width, y: p.y / project.settings.height };
  };
  const o = at(0, 0), ex = at(1, 0), ey = at(0, 1);
  const a = ex.x - o.x, b = ey.x - o.x, c = ex.y - o.y, d = ey.y - o.y;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error("The clip is scaled to nothing at this time");
  return {
    forward: (p: MaskPoint): MaskPoint => ({ x: o.x + a * p.x + b * p.y, y: o.y + c * p.x + d * p.y }),
    inverse: (p: MaskPoint): MaskPoint => ({ x: (d * (p.x - o.x) - b * (p.y - o.y)) / det, y: (-c * (p.x - o.x) + a * (p.y - o.y)) / det }),
  };
}

/** The stabilizing warp of the clip at a clip-local time as a map on composition positions; null without a Warp Stabilizer analysis. */
export function warpMapAt(place: Placement, localTime: number): PointMap | null {
  if (!clipHasWarp(place.clip)) return null;
  try {
    const sourceTime = (place.clip.inPoint ?? 0) + getSpeedEngine().getSourceTimeAtPlaybackTime(place.clip.id, localTime);
    return warpCompositionMap(place.clip, sourceTime, place.media.metadata.width, place.media.metadata.height, affineAt(place, localTime));
  } catch {
    return null;
  }
}

/** The map that takes a source-space mask path to where the monitor shows it at `time` (timeline seconds); null when they are the same. */
export function displayMapOf(clipId: string, mask: Pick<Mask, "space">, time: number): PointMap | null {
  if (mask.space !== "source") return null;
  try {
    const place = placementOf(clipId);
    return warpMapAt(place, Math.max(0, time - place.clip.startTime));
  } catch {
    return null;
  }
}

/** The outline the monitor shows for the mask at `time` (a source-space path moved with the stabilizing warp). */
export function displayPathOf(clipId: string, mask: Mask, time: number): BezierPath {
  const path = maskPathAtTime(mask, time);
  const map = displayMapOf(clipId, mask, time);
  return map ? mapPath(path, map.forward) : path;
}

/** The inverse of `displayPathOf`: an outline edited on the monitor at `time`, as the mask stores it. */
export function storedPathOf(clipId: string, mask: Mask, time: number): (shown: BezierPath) => BezierPath {
  const map = displayMapOf(clipId, mask, time);
  return map ? (shown) => mapPath(shown, map.inverse) : (shown) => shown;
}

/** The mask with its path and keyframes moved onto the unstabilized picture (the space object masks are tracked in). */
export function maskInSourceSpace(place: Placement, mask: Mask, anchorTime: number): Mask {
  if (mask.space === "source") return mask;
  const toSource = (path: BezierPath, time: number): BezierPath => {
    const warp = warpMapAt(place, Math.max(0, time - place.clip.startTime));
    return warp ? mapPath(path, warp.inverse) : path;
  };
  return {
    ...mask,
    space: "source",
    path: toSource(mask.path, anchorTime),
    keyframes: mask.keyframes.map((key) => ({ ...key, path: toSource(key.path, key.time) })),
  };
}

export function mapPath(path: BezierPath, map: (p: MaskPoint) => MaskPoint): BezierPath {
  return {
    closed: path.closed,
    points: path.points.map((point): BezierPoint => ({
      ...map(point),
      ...(point.handleIn ? { handleIn: map(point.handleIn) } : {}),
      ...(point.handleOut ? { handleOut: map(point.handleOut) } : {}),
    })),
  };
}

export const fullRegion = (media: MediaItem) => ({ x: 0, y: 0, width: media.metadata.width, height: media.metadata.height });

function frameAt(place: Placement, time: number, lastFrame: number): number {
  return Math.max(0, Math.min(lastFrame, Math.round((time - place.clip.startTime) * place.fps)));
}

/** What the user marked, in normalised composition coordinates. */
export interface ObjectMaskPrompt {
  include: MaskPoint[];
  exclude: MaskPoint[];
  strokes: Array<{ points: MaskPoint[]; include: boolean }>;
}

let sharedEngine: ObjectMaskEngine | null = null;
let engineIdle: ReturnType<typeof setTimeout> | null = null;
function useEngine<T>(run: (engine: ObjectMaskEngine) => Promise<T>): Promise<T> {
  if (engineIdle) clearTimeout(engineIdle);
  sharedEngine ??= createObjectMaskEngine();
  return run(sharedEngine).finally(() => {
    // The worker is only kept for a burst of clicks; an idle one is released.
    engineIdle = setTimeout(() => { sharedEngine?.dispose(); sharedEngine = null; }, 30_000);
  });
}

/** Segment the object under the prompt on the clip's frame at the playhead; the outline in composition space. */
export async function segmentObjectPath(clipId: string, prompt: ObjectMaskPrompt, time = useTimelineStore.getState().playheadPosition): Promise<{ path: BezierPath; confidence: number }> {
  const place = placementOf(clipId);
  const controller = new AbortController();
  const source = createMotionTrackingSource(clipId, fullRegion(place.media), controller.signal, undefined, FRAME_MIDDLE);
  try {
    const frameIndex = frameAt(place, time, source.lastFrame);
    const image = await source.readFrame(frameIndex);
    if (!image) throw new Error("The frame could not be read");
    const localTime = Math.max(0, time - place.clip.startTime);
    const affine = affineAt(place, localTime);
    // The marks are on the stabilized monitor; the footage is read as shot.
    const warp = warpMapAt(place, localTime);
    const toImage = (p: MaskPoint) => {
      const s = affine.inverse(warp ? warp.inverse(p) : p);
      return { x: s.x * image.width, y: s.y * image.height };
    };
    const radius = Math.max(2, Math.min(image.width, image.height) * 0.012);
    const request: SegmentPrompt = {
      include: [...prompt.include.map(toImage), ...prompt.strokes.filter((s) => s.include && s.points.length === 1).map((s) => toImage(s.points[0]))],
      exclude: [...prompt.exclude.map(toImage), ...prompt.strokes.filter((s) => !s.include && s.points.length === 1).map((s) => toImage(s.points[0]))],
      strokes: prompt.strokes.filter((s) => s.points.length > 1).map((s) => ({ include: s.include, radius, points: s.points.map(toImage) })),
    };
    const result = await useEngine((engine) => engine.segment(image, request));
    const { maskToPath } = await import("@openreel/core/video/object-mask/index");
    const outline = maskToPath(result.mask, result.width, result.height);
    if (!outline) throw new Error("No object was found there. Click inside the object, or brush over it.");
    return { path: mapPath(outline, affine.forward), confidence: result.confidence };
  } finally {
    source.dispose();
  }
}

/** Click or brush: creates the mask (one undo step) or, with `maskId`, replaces that mask's outline (one undo step). */
export async function applyObjectSegmentation(clipId: string, prompt: ObjectMaskPrompt, maskId: string | null): Promise<string> {
  const { path } = await segmentObjectPath(clipId, prompt);
  if (maskId && maskOf(clipId, maskId)) {
    const ok = await commitMaskEdit(clipId, maskId, (mask) => ({ ...mask, path, keyframes: [], space: "source" }));
    if (!ok) throw new Error("The mask could not be updated");
    return maskId;
  }
  const created = await commitNewMask(clipId, path, "source");
  if (!created) throw new Error("The mask could not be added");
  return created;
}

/** Default tolerance (composition pixels) of the keyframe simplification applied to a tracked mask; 0 keeps one keyframe per frame. */
export const DEFAULT_KEYFRAME_TOLERANCE = 2;

export interface ObjectTrackReport { frames: number; lostFrames: number; keyframes: number }

/**
 * Track the mask through the clip from the playhead: the mask's outline at the playhead (hand edits included) is the
 * start, every frame after (forward) or before (backward) gets a keyframe. Existing keyframes inside the tracked
 * range are replaced, the rest stay. One undo step.
 */
export async function trackObjectMask(clipId: string, maskId: string, direction: "forward" | "backward", signal: AbortSignal, onProgress?: (percent: number, lostFrames: number) => void, simplifyTolerance = DEFAULT_KEYFRAME_TOLERANCE): Promise<ObjectTrackReport> {
  const place = placementOf(clipId);
  const mask = maskOf(clipId, maskId);
  if (!mask) throw new Error("The mask no longer exists");
  if (mask.type === "track-matte") throw new Error("A track matte follows its source clip; pick a drawn or shape mask");
  const playhead = useTimelineStore.getState().playheadPosition;
  const { mergeTrackedKeyframes, simplifyMaskKeyframes, trackedFramesToKeyframes } = await import("@openreel/core/video/object-mask/index");
  const source = createMotionTrackingSource(clipId, fullRegion(place.media), signal, undefined, FRAME_MIDDLE);
  const engine = createObjectMaskEngine();
  try {
    const anchor = frameAt(place, playhead, source.lastFrame);
    const end = direction === "forward" ? source.lastFrame : 0;
    const anchorTime = place.clip.startTime + anchor / place.fps;
    const anchorAffine = affineAt(place, anchor / place.fps);
    // The anchor outline is whatever the mask shows on the monitor; the tracker follows it on the footage as shot.
    const sourceMask = maskInSourceSpace(place, mask, anchorTime);
    const anchorPath = mapPath(maskPathAtTime(sourceMask, anchorTime), anchorAffine.inverse);
    const first = await source.readFrame(anchor);
    if (!first) throw new Error("The frame could not be read");
    await engine.beginTrack(first, anchorPath);
    const frames: ObjectTrackFrame[] = [{ frame: anchor, path: anchorPath, confidence: 1, lost: false }];
    const step = direction === "forward" ? 1 : -1;
    const span = Math.max(1, Math.abs(end - anchor));
    let lost = 0;
    for (let frame = anchor + step; direction === "forward" ? frame <= end : frame >= end; frame += step) {
      if (signal.aborted) throw new DOMException("Tracking cancelled", "AbortError");
      const image: RGBAFrame | null = await source.readFrame(frame);
      if (!image) break;
      const result = await engine.step(frame, image);
      if (result.lost) lost++;
      frames.push(result);
      onProgress?.((Math.abs(frame - anchor) / span) * 100, lost);
    }
    if (signal.aborted) throw new DOMException("Tracking cancelled", "AbortError");
    source.assertCurrent();
    // One keyframe per tracked frame, then Ramer-Douglas-Peucker over time: only the keyframes the motion needs stay.
    const tracked = simplifyMaskKeyframes(
      trackedFramesToKeyframes(frames, {
        timeOf: (frame) => place.clip.startTime + frame / place.fps,
        mapPath: (frame, path) => mapPath(path, affineAt(place, frame / place.fps).forward),
      }),
      { tolerance: simplifyTolerance, width: place.project.settings.width, height: place.project.settings.height },
    );
    const state = useProjectStore.getState();
    const scope = { projectId: state.project.id, clipId, history: state.actionHistory };
    const saved = await editClipMasks(scope, (current) => current.map((m) => {
      if (m.id !== maskId) return m;
      const stored = maskInSourceSpace(place, m, anchorTime);
      return { ...stored, keyframes: mergeTrackedKeyframes(stored.keyframes, tracked, 0.5 / place.fps) };
    }));
    if (!saved) throw new Error("The tracked mask could not be saved");
    return { frames: frames.length, lostFrames: lost, keyframes: tracked.length };
  } finally {
    engine.dispose();
    source.dispose();
  }
}
