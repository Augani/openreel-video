import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { DEFAULT_WARP_SETTINGS, getWarpRegistry, normalizeWarpSettings, isWarpAnalysis, warpPlanFor, dropWarpNeighbours } from "@openreel/core";
import type { Clip, WarpAnalysis, WarpSettings } from "@openreel/core";
import { warpAnalysisKey } from "@openreel/core/video/stabilization/warp/registry";
import { useProjectStore } from "../stores/project-store";
import { renderCacheService } from "./render-cache-service";

/**
 * Warp Stabilizer on the timeline: analyses a clip's footage in a worker (shown in the background task list with
 * a cancel button), keeps the measured motion on the clip through the action system (so enabling, every setting
 * change and the analysis itself are undoable and saved with the project), and reuses a finished analysis of the
 * same footage and range instead of measuring it again. Changing a setting never re-analyses.
 */
const controllers = new Map<string, AbortController>();

const findClip = (clipId: string): Clip | undefined => {
  for (const track of useProjectStore.getState().project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
};

function writeStabilization(clipId: string, next: NonNullable<Clip["stabilization"]>): void {
  void useProjectStore.getState().executeAction({
    type: "clip/setStabilization",
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params: { clipId, stabilization: next },
  });
}

const baseOf = (clip: Clip): NonNullable<Clip["stabilization"]> =>
  clip.stabilization ?? { enabled: false, strength: 50, cropMode: "auto", analyzed: false };

function refreshRender(clip: Clip): void {
  dropWarpNeighbours(clip.id);
  try {
    renderCacheService.instance.invalidateRanges([{ start: clip.startTime, end: clip.startTime + clip.duration }]);
  } catch {
    // the render cache is optional
  }
}

/** True when the clip's analysis covers its current in/out range (a trim past it needs a new analysis). */
export function warpAnalysisCovers(clip: Clip): boolean {
  const analysis = clip.stabilization?.warpAnalysis;
  if (!analysis || !isWarpAnalysis(analysis)) return false;
  const end = analysis.startTime + (analysis.frameCount - 1) / analysis.fps;
  return clip.inPoint >= analysis.startTime - 0.05 && clip.outPoint <= end + 0.1;
}

export function cancelWarpAnalysis(clipId: string): void {
  controllers.get(clipId)?.abort();
}

export function isWarpAnalysing(clipId: string): boolean {
  return controllers.has(clipId);
}

/** Analyse the clip (or reuse the cached analysis) and turn the stabilizer on. */
export async function startWarpStabilizer(clipId: string, settings?: Partial<WarpSettings>): Promise<void> {
  const clip = findClip(clipId);
  const registry = getWarpRegistry();
  if (!clip || controllers.has(clipId)) return;
  const media = useProjectStore.getState().getMediaItem(clip.mediaId);
  if (!media?.blob) {
    registry.setJob(clipId, { status: "failed", message: "The footage for this clip is not available" });
    return;
  }
  const warp = normalizeWarpSettings({ ...(baseOf(clip).warp ?? DEFAULT_WARP_SETTINGS), ...settings });
  registry.setFootage(clipId, { blob: media.blob, mediaId: media.id });
  const key = warpAnalysisKey(media.id, media.blob.size, clip.inPoint, clip.outPoint);
  const have = warpAnalysisCovers(clip) ? clip.stabilization?.warpAnalysis : registry.getCached(key);
  if (have) {
    registry.putCached(key, have);
    writeStabilization(clipId, { ...baseOf(clip), enabled: true, analyzed: false, warp, warpAnalysis: have });
    registry.setJob(clipId, { status: "idle" });
    refreshRender(clip);
    return;
  }

  const controller = new AbortController();
  controllers.set(clipId, controller);
  registry.setJob(clipId, { status: "analysing", progress: 0 });
  try {
    const analysis: WarpAnalysis = await backgroundTasks.track(
      { kind: "analysis", source: "stabilizer", title: `Warp Stabilizer · ${media.name}`, detail: "Analysing in background" },
      async (ctx) => {
        ctx.signal.addEventListener("abort", () => controller.abort(), { once: true });
        const onTaskCancel = controller.signal;
        const { analyseWarpFootage } = await import("@openreel/core/video/stabilization/warp/analysis-client");
        return analyseWarpFootage(
          { blob: media.blob as Blob, startTime: clip.inPoint, endTime: clip.outPoint },
          {
            signal: onTaskCancel,
            onProgress: (fraction) => {
              registry.setJob(clipId, { status: "analysing", progress: fraction });
              ctx.progress(fraction, "Analysing in background");
            },
          },
        );
      },
    );
    registry.putCached(key, analysis);
    registry.setJob(clipId, { status: "stabilizing" });
    const latest = findClip(clipId);
    if (!latest) {
      registry.setJob(clipId, { status: "idle" });
      return;
    }
    const next = { ...baseOf(latest), enabled: true, analyzed: false, warp, warpAnalysis: analysis };
    // the plan (smoothing, crop solve) is built now so the first frame does not pay for it
    warpPlanFor({ id: clipId, stabilization: next });
    writeStabilization(clipId, next);
    refreshRender(latest);
    registry.setJob(clipId, { status: "idle" });
  } catch (error) {
    if (controller.signal.aborted || (error as { name?: unknown } | null)?.name === "AbortError") registry.setJob(clipId, { status: "idle" });
    else registry.setJob(clipId, { status: "failed", message: error instanceof Error ? error.message : "Stabilization failed" });
  } finally {
    controllers.delete(clipId);
  }
}

/** Change Warp Stabilizer settings (one undoable edit; the analysis is kept). */
export function updateWarpSettings(clipId: string, patch: Partial<WarpSettings>): void {
  const clip = findClip(clipId);
  if (!clip?.stabilization) return;
  const warp = normalizeWarpSettings({ ...(clip.stabilization.warp ?? DEFAULT_WARP_SETTINGS), ...patch });
  writeStabilization(clipId, { ...clip.stabilization, warp });
  refreshRender(clip);
}

/** Turn the stabilizer off (analysis kept) or back on (analyse first when there is none). */
export function setWarpEnabled(clipId: string, enabled: boolean): void {
  const clip = findClip(clipId);
  if (!clip) return;
  if (!enabled) {
    cancelWarpAnalysis(clipId);
    if (clip.stabilization?.enabled) {
      writeStabilization(clipId, { ...clip.stabilization, enabled: false });
      refreshRender(clip);
    }
    return;
  }
  void startWarpStabilizer(clipId);
}
