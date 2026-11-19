import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import {
  detectScenes,
  initializeMediaEngine,
  createAbortError,
  type Clip,
  type Project,
  type SceneCut,
  type SceneDetectionProgress,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { getLinkedTimelineSelection } from "../utils/linked-timeline-selection";
import { EditingSession } from "./agent/editing-session";
import { createTrackingTimeMapper } from "./motion-tracking-source";

/** Frames per second sampled from the source. */
export const SCENE_SAMPLE_RATE = 5;
/** Width of the downscaled frames used for analysis. */
export const SCENE_SAMPLE_WIDTH = 96;
const MARKER_COLOR = "#3b82f6";
const EPSILON = 1e-4;

export interface SceneDetectionRunOptions {
  /** 0..1 */
  sensitivity: number;
  /** Seconds. */
  minSceneLength: number;
  signal?: AbortSignal;
  onProgress?: (progress: SceneDetectionProgress) => void;
}

/** Cuts are stored in SOURCE time so they can be re-mapped at apply time. */
export interface SceneAnalysis {
  readonly projectId: string;
  readonly clipId: string;
  readonly mediaId: string;
  readonly cuts: readonly SceneCut[];
}

export interface ApplySceneCutsOptions {
  splitClip: boolean;
  addMarkers: boolean;
}

export interface ApplySceneCutsResult {
  splits: number;
  markers: number;
  /** Linked clips on locked tracks that were left untouched. */
  skippedLockedLinked: number;
  /** Cuts that no longer fall inside the clip as it is now. */
  droppedCuts: number;
}

export function isReversedClip(clip: Clip): boolean {
  return !!clip.reversed || (clip.speed ?? 1) < 0;
}

/** Speed ramps and freeze frames map source time nonlinearly. */
export function hasNonlinearSpeed(clip: Clip): boolean {
  return !!clip.speedKeyframes?.length || !!clip.freezeFrames?.length;
}

/** Returns a user-facing reason the clip cannot be analysed, or null. */
export function sceneDetectionBlockReason(
  project: Project,
  clipId: string,
): string | null {
  const track = project.timeline.tracks.find((t) =>
    t.clips.some((c) => c.id === clipId),
  );
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!clip || !track) return "The clip is no longer on the timeline.";
  if (track.type === "audio") return "Select a video clip.";
  const media = project.mediaLibrary.items.find((m) => m.id === clip.mediaId);
  if (!media || media.type !== "video") return "Select a video clip.";
  if (isReversedClip(clip))
    return "Reversed clips are not supported. Turn off Reverse and try again.";
  if (!media.blob || typeof media.blob.arrayBuffer !== "function")
    return "Relink the source media before detecting scenes.";
  return null;
}

/** Maps a source time to timeline time using the clip's current speed state. */
export function sourceToTimelineTime(clip: Clip, sourceTime: number): number {
  if (clip.speedKeyframes?.length || clip.freezeFrames?.length) {
    // Source time is monotone in playback time for a non-reversed clip.
    const map = createTrackingTimeMapper(clip);
    let lo = 0;
    let hi = clip.duration;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (map(mid) < sourceTime) lo = mid;
      else hi = mid;
    }
    return clip.startTime + hi;
  }
  const speed = Math.abs(clip.speed ?? 1) || 1;
  return clip.startTime + (sourceTime - clip.inPoint) / speed;
}

/** Decodes small frames across the clip's source range and finds hard cuts. */
export function analyseClipScenes(
  clipId: string,
  options: SceneDetectionRunOptions,
): Promise<SceneAnalysis> {
  return backgroundTasks.track({ kind: "analysis", source: "scene-detection", title: "Scene edit detection" }, (ctx) => {
    // The dialog's own signal and the task panel's cancel both stop the run.
    const external = options.signal;
    if (external?.aborted) backgroundTasks.cancel(ctx.id);
    else external?.addEventListener("abort", () => backgroundTasks.cancel(ctx.id), { once: true });
    return runSceneAnalysis(clipId, {
      ...options,
      signal: ctx.signal,
      onProgress: (p) => {
        ctx.progress(p.fraction);
        options.onProgress?.(p);
      },
    });
  });
}

async function runSceneAnalysis(
  clipId: string,
  options: SceneDetectionRunOptions,
): Promise<SceneAnalysis> {
  const { project, getClip } = useProjectStore.getState();
  const reason = sceneDetectionBlockReason(project, clipId);
  if (reason) throw new Error(reason);
  const clip = getClip(clipId)!;
  const media = project.mediaLibrary.items.find((m) => m.id === clip.mediaId)!;
  const { signal } = options;
  if (signal?.aborted) throw createAbortError();

  const engine = await initializeMediaEngine();
  const decoderId = `scene-detect-${crypto.randomUUID()}`;
  try {
    const decoder = await engine.createExportDecoder(
      decoderId,
      media.blob!,
      SCENE_SAMPLE_WIDTH,
    );
    if (!decoder) throw new Error("This video cannot be decoded for analysis.");
    if (signal?.aborted) throw createAbortError();
    const result = await detectScenes({
      sampler: async (time) => {
        const canvas = await decoder.getFrame(time);
        const context = canvas?.getContext("2d", { willReadFrequently: true });
        if (!canvas || !context) return null;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        return {
          data: pixels.data,
          width: pixels.width,
          height: pixels.height,
        };
      },
      startTime: clip.inPoint,
      endTime: clip.outPoint,
      sampleRate: SCENE_SAMPLE_RATE,
      sensitivity: options.sensitivity,
      minSceneLength: options.minSceneLength,
      signal,
      onProgress: options.onProgress,
    });
    return {
      projectId: project.id,
      clipId,
      mediaId: clip.mediaId,
      cuts: result.cuts,
    };
  } finally {
    engine.disposeExportDecoder(decoderId);
  }
}

export interface ScenePlan {
  /** Ascending timeline times, snapped to the project frame grid. */
  times: number[];
  droppedCuts: number;
  /** Clips (the source first) that will be split. */
  splitTargets: Clip[];
  skippedLockedLinked: number;
}

/** Re-maps cuts onto the clip as it is NOW and resolves the clips to split. */
export function planSceneCuts(
  project: Project,
  analysis: SceneAnalysis,
  linked: boolean,
): ScenePlan {
  const clip = project.timeline.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === analysis.clipId);
  if (!clip) throw new Error("The clip is no longer on the timeline.");
  if (clip.mediaId !== analysis.mediaId)
    throw new Error("The clip's source changed. Analyse it again.");
  if (isReversedClip(clip))
    throw new Error("Reversed clips are not supported.");
  const frame = 1 / Math.max(1, project.settings.frameRate || 30);
  const end = clip.startTime + clip.duration;
  const times: number[] = [];
  let droppedCuts = 0;
  for (const cut of [...analysis.cuts].sort((a, b) => a.time - b.time)) {
    const raw = sourceToTimelineTime(clip, cut.time);
    const snapped = Math.round(raw / frame) * frame;
    const last = times[times.length - 1];
    if (
      !Number.isFinite(snapped) ||
      snapped <= clip.startTime + frame / 2 ||
      snapped >= end - frame / 2 ||
      (last !== undefined && snapped - last < frame / 2)
    ) {
      droppedCuts++;
      continue;
    }
    times.push(snapped);
  }
  const ids = getLinkedTimelineSelection(project, [clip.id], linked).filter(
    (id) => id !== clip.id,
  );
  const lookup = new Map(
    project.timeline.tracks.flatMap((t) =>
      t.clips.map((c) => [c.id, { clip: c, locked: t.locked }] as const),
    ),
  );
  const splitTargets: Clip[] = [clip];
  let skippedLockedLinked = 0;
  for (const id of ids) {
    const entry = lookup.get(id);
    if (!entry) continue;
    if (entry.locked) skippedLockedLinked++;
    else splitTargets.push(entry.clip);
  }
  return { times, droppedCuts, splitTargets, skippedLockedLinked };
}

function assertEditable(project: Project, clipId: string): void {
  const track = project.timeline.tracks.find((t) =>
    t.clips.some((c) => c.id === clipId),
  );
  if (!track) throw new Error("The clip is no longer on the timeline.");
  if (track.locked) throw new Error("Unlock the clip's track before applying.");
  if (
    useUIStore.getState().exportState.isExporting ||
    useUIStore.getState().effectApplicationClipId !== null ||
    useTimelineStore.getState().playbackLockedReason
  )
    throw new Error("Finish the current export or operation first.");
}

/**
 * Applies detected cuts as exactly one undo step. Every split runs through the
 * source-preserving `clip/split` action on an isolated draft (speed, fades,
 * keyframes and linked audio included), then the draft is committed once.
 */
export async function applySceneCuts(
  analysis: SceneAnalysis,
  options: ApplySceneCutsOptions,
): Promise<ApplySceneCutsResult> {
  const result: ApplySceneCutsResult = {
    splits: 0,
    markers: 0,
    skippedLockedLinked: 0,
    droppedCuts: 0,
  };
  const store = useProjectStore.getState();
  if (!store.hasOpenProject || store.project.id !== analysis.projectId)
    throw new Error("The project changed. Analyse the clip again.");
  assertEditable(store.project, analysis.clipId);
  const plan = planSceneCuts(
    store.getFullProject(),
    analysis,
    useEditorWorkspaceStore.getState().linkedSelection,
  );
  result.droppedCuts = plan.droppedCuts;
  result.skippedLockedLinked = options.splitClip ? plan.skippedLockedLinked : 0;
  if (plan.times.length === 0) return result;
  // The base split keeps source ranges 1:1 for ramped clips, so pieces would
  // show the wrong footage. Markers remain safe because they only mark time.
  if (options.splitClip && plan.splitTargets.some(hasNonlinearSpeed))
    throw new Error(
      "Clips with speed ramps or freeze frames cannot be split here. Turn off Split clip and add markers instead.",
    );

  const session = new EditingSession();
  const transaction = session.beginTransaction();
  const apply = async (type: string, params: Record<string, unknown>) => {
    const outcome = await session.applyAction({
      type,
      params,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    });
    if (!outcome.success)
      throw new Error(outcome.error?.message ?? "Could not apply the cuts.");
  };

  if (options.splitClip) {
    // Latest cut first: the original ids always keep the earlier piece.
    for (const time of [...plan.times].reverse()) {
      for (const target of plan.splitTargets) {
        const draftClip = session
          .getProject()
          .timeline.tracks.flatMap((t) => t.clips)
          .find((c) => c.id === target.id);
        if (
          !draftClip ||
          time <= draftClip.startTime + EPSILON ||
          time >= draftClip.startTime + draftClip.duration - EPSILON
        )
          continue;
        await apply("clip/split", { clipId: target.id, time });
        if (target.id === analysis.clipId) result.splits++;
      }
    }
  }
  if (options.addMarkers) {
    const existing = session.getProject().timeline.markers;
    for (const [index, time] of plan.times.entries()) {
      if (existing.some((m) => Math.abs(m.time - time) < EPSILON)) continue;
      await apply("marker/add", {
        time,
        label: `Cut ${index + 1}`,
        color: MARKER_COLOR,
      });
      result.markers++;
    }
  }
  if (result.splits === 0 && result.markers === 0) return result;
  await session.commitTransaction(transaction, "Scene edit detection");
  return result;
}
