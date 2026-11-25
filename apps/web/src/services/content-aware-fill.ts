import { clipHasWarp, maskPathAtTime, type Clip, type Mask, type Project } from "@openreel/core";
import { getRemovalAnalysis } from "@openreel/core/video/content-aware-fill/registry";
import { DEFAULT_OBJECT_REMOVAL, type FillPatch, type ObjectRemovalSettings, type RemovalAnalysis } from "@openreel/core/video/content-aware-fill/types";
import { removalTimingOf } from "@openreel/core/video/content-aware-fill/apply";
import { analysisKeyOf } from "@openreel/core/video/content-aware-fill/signature";
import { useProjectStore } from "../stores/project-store";
import { createMotionTrackingSource, motionTrackingSourceSignature } from "./motion-tracking-source";
import { createContentFillEngine } from "./content-fill-engine";
import { saveRemovalAnalysis } from "./content-fill-cache";
import { affineAt, FRAME_MIDDLE, fullRegion, mapPath, placementOf, warpMapAt } from "./object-mask";
import { maskOf } from "./mask-pen";
import { renderCacheService } from "./render-cache-service";

/**
 * Remove Object (Content-Aware Fill) on a clip. The tracked object mask marks what goes; the clip's footage is
 * read frame by frame in source space, and a worker fills the marked area from other frames (aligned with global
 * motion) and from its surroundings (PatchMatch). The analysis is cached per clip (memory + IndexedDB) under a key
 * of everything it depends on; the clip keeps only the settings and that key, through one undoable action.
 */

const ANALYSIS_LONG_SIDE = 480;
const ANALYSIS_VERSION = 1;

export interface ObjectRemovalReport { frames: number; filledFrames: number; temporalShare: number }

const clipOf = (clipId: string): Clip | undefined =>
  useProjectStore.getState().project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);

/** What a mask drawn on the stabilized picture depends on: the stabilizing warp that maps it back to the footage. */
function warpDependency(clip: Clip, mask: Mask): unknown {
  if (mask.space === "source" || !clipHasWarp(clip)) return null;
  const analysis = clip.stabilization?.warpAnalysis;
  return { settings: clip.stabilization?.warp ?? null, frames: analysis?.frameCount ?? 0, motion: analysis ? analysis.motion.reduce((sum, value, index) => sum + value * ((index % 7) + 1), 0) : 0 };
}

/** Everything the analysis of this clip and mask depends on. A different key means the stored fill no longer matches. */
export function removalKeyFor(clipId: string, mask: Mask, settings: Pick<ObjectRemovalSettings, "dilate" | "feather">): string {
  const place = placementOf(clipId);
  const { clip, project, media } = place;
  return analysisKeyOf({
    version: ANALYSIS_VERSION,
    clipId,
    source: motionTrackingSourceSignature(project, clip, media),
    composition: [project.settings.width, project.settings.height],
    transform: clip.transform,
    clipKeyframes: clip.keyframes,
    startTime: clip.startTime,
    mask: { path: mask.path, space: mask.space ?? null, keyframes: mask.keyframes.map((k) => ({ time: k.time, path: k.path })) },
    warp: warpDependency(clip, mask),
    dilate: settings.dilate,
    feather: settings.feather,
    size: ANALYSIS_LONG_SIDE,
  });
}

/** The saved analysis of a clip no longer matches its mask or footage (the mask was edited, the clip trimmed...). */
export function removalIsStale(clipId: string): boolean {
  const settings = clipOf(clipId)?.objectRemoval;
  if (!settings) return false;
  const mask = maskOf(clipId, settings.maskId);
  if (!mask) return true;
  try {
    return removalKeyFor(clipId, mask, settings) !== settings.analysisKey;
  } catch {
    return true;
  }
}

function writeSettings(clipId: string, objectRemoval: ObjectRemovalSettings | null): Promise<boolean> {
  return useProjectStore.getState().executeAction({
    type: "clip/setObjectRemoval",
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params: { clipId, objectRemoval },
  }).then((result) => result.success);
}

function refreshPreview(clipId: string): void {
  const clip = clipOf(clipId);
  if (!clip) return;
  try {
    renderCacheService.instance.invalidateRanges([{ start: clip.startTime, end: clip.startTime + clip.duration }]);
  } catch {
    // the render cache is optional
  }
}

export async function setObjectRemovalEnabled(clipId: string, enabled: boolean): Promise<boolean> {
  const current = clipOf(clipId)?.objectRemoval;
  if (!current) return false;
  const ok = await writeSettings(clipId, { ...current, enabled });
  refreshPreview(clipId);
  return ok;
}

export async function clearObjectRemoval(clipId: string): Promise<boolean> {
  if (!clipOf(clipId)?.objectRemoval) return false;
  const ok = await writeSettings(clipId, null);
  refreshPreview(clipId);
  return ok;
}

interface AnalysisRun { analysis: RemovalAnalysis; report: ObjectRemovalReport }

/** The analysis itself: reads the clip's footage frame by frame and fills the mask from other frames. Saves nothing. */
async function analyseRemoval(
  clipId: string,
  maskId: string,
  dilate: number,
  feather: number,
  signal: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<AnalysisRun> {
  const place = placementOf(clipId);
  const mask = maskOf(clipId, maskId);
  if (!mask) throw new Error("The mask no longer exists");
  if (mask.type === "track-matte") throw new Error("Pick a drawn or shape mask around the object to remove");
  const key = removalKeyFor(clipId, mask, { dilate, feather });
  const { rasterizePath } = await import("@openreel/core/video/object-mask/index");

  const source = createMotionTrackingSource(clipId, fullRegion(place.media), signal, undefined, FRAME_MIDDLE);
  const engine = createContentFillEngine();
  const onAbort = (): void => engine.dispose();
  signal.addEventListener("abort", onAbort);
  try {
    const total = source.lastFrame + 1;
    const first = await source.readFrame(0);
    if (!first) throw new Error("The first frame could not be read");
    const longSide = Math.max(first.width, first.height);
    const scale = longSide / 1000;
    await engine.begin({ dilate: Math.max(0, Math.round(dilate * scale)), feather: Math.max(0, Math.round(feather * scale)) });
    const reach = 32;
    const frames: Array<FillPatch | null> = [];
    let pushed = -1;
    let filled = 0;
    let shareSum = 0;
    const push = async (index: number): Promise<void> => {
      const image = index === 0 ? first : await source.readFrame(index);
      if (!image) throw new Error(`Frame ${index} could not be read`);
      const time = place.clip.startTime + index / place.fps;
      // Remove Object works on the footage as shot (before the warp): a mask drawn on the stabilized picture is moved back first.
      const outline = maskPathAtTime(mask, time);
      const warp = mask.space === "source" ? null : warpMapAt(place, index / place.fps);
      const path = mapPath(warp ? mapPath(outline, warp.inverse) : outline, affineAt(place, index / place.fps).inverse);
      await engine.push(index, image, rasterizePath(path, image.width, image.height));
    };
    for (let index = 0; index < total; index++) {
      if (signal.aborted) throw new DOMException("Remove Object cancelled", "AbortError");
      while (pushed < Math.min(total - 1, index + reach)) await push(++pushed);
      const report = await engine.fill(index);
      frames.push(report.patch);
      if (report.patch) {
        filled++;
        shareSum += report.temporalShare;
      }
      if (index > reach + 1) await engine.release(index - reach - 1);
      onProgress?.(((index + 1) / total) * 100);
    }
    if (signal.aborted) throw new DOMException("Remove Object cancelled", "AbortError");
    source.assertCurrent();
    if (filled === 0) throw new Error("The mask does not cover anything in this clip. Track or adjust it, then try again.");
    return {
      analysis: { key, width: first.width, height: first.height, fps: place.fps, frames },
      report: { frames: total, filledFrames: filled, temporalShare: shareSum / filled },
    };
  } catch (error) {
    if (signal.aborted) throw new DOMException("Remove Object cancelled", "AbortError");
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    engine.dispose();
    source.dispose();
  }
}

/**
 * Analyse the clip for the mask and turn Remove Object on (one undo step). Progress is 0..100; abort cancels and
 * leaves the clip as it was.
 */
export async function removeObject(
  clipId: string,
  maskId: string,
  options: Partial<Pick<ObjectRemovalSettings, "dilate" | "feather">>,
  signal: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<ObjectRemovalReport> {
  const place = placementOf(clipId);
  const dilate = options.dilate ?? place.clip.objectRemoval?.dilate ?? DEFAULT_OBJECT_REMOVAL.dilate;
  const feather = options.feather ?? place.clip.objectRemoval?.feather ?? DEFAULT_OBJECT_REMOVAL.feather;
  const { analysis, report } = await analyseRemoval(clipId, maskId, dilate, feather, signal, onProgress);
  await saveRemovalAnalysis(clipId, analysis);
  const saved = await writeSettings(clipId, { enabled: true, maskId, analysisKey: analysis.key, timing: removalTimingOf(place.clip), dilate, feather });
  if (!saved) throw new Error("Remove Object could not be saved");
  refreshPreview(clipId);
  return report;
}

/** Clips of the project whose Remove Object fill is on but whose analysis is gone (the IndexedDB cache was cleared). */
export async function clipsMissingRemovalAnalysis(project: Pick<Project, "timeline">): Promise<Clip[]> {
  const missing: Clip[] = [];
  for (const clip of project.timeline.tracks.flatMap((track) => track.clips)) {
    const settings = clip.objectRemoval;
    if (!settings?.enabled || typeof settings.analysisKey !== "string") continue;
    if (settings.timing !== undefined && settings.timing !== removalTimingOf(clip)) continue; // the export reports this one
    if (await getRemovalAnalysis(clip.id, settings.analysisKey)) continue;
    missing.push(clip);
  }
  return missing;
}

/**
 * Before an export: re-run the analysis of every Remove Object clip whose cache was cleared, with progress, so the
 * export renders the same fill the Program monitor shows instead of stopping. The analysis is rebuilt under the key
 * the clip already stores, so the project and its undo history are untouched. A clip whose mask or footage changed
 * since (a different key) is left alone: the export then asks for a fresh Remove Object run, as before.
 * `onProgress` gets 0..1 over all the clips and a label. Returns how many clips were re-analysed.
 */
export async function ensureRemovalAnalysesForExport(
  project: Pick<Project, "timeline">,
  signal: AbortSignal,
  onProgress?: (fraction: number, label: string) => void,
): Promise<number> {
  const missing = await clipsMissingRemovalAnalysis(project);
  let done = 0;
  const queue: Array<{ clipId: string; maskId: string; dilate: number; feather: number; key: string }> = [];
  for (const exported of missing) {
    const settings = exported.objectRemoval;
    const live = clipOf(exported.id);
    if (!settings || !live) continue;
    const mask = maskOf(exported.id, settings.maskId);
    if (!mask || mask.type === "track-matte") continue;
    try {
      const key = removalKeyFor(exported.id, mask, settings);
      if (key !== settings.analysisKey) continue;
      queue.push({ clipId: exported.id, maskId: settings.maskId, dilate: settings.dilate, feather: settings.feather, key });
    } catch {
      continue;
    }
  }
  for (const [index, item] of queue.entries()) {
    const label = queue.length > 1 ? `Analysing Remove Object (${index + 1} of ${queue.length})` : "Analysing Remove Object";
    onProgress?.(index / queue.length, label);
    const { analysis } = await analyseRemoval(item.clipId, item.maskId, item.dilate, item.feather, signal, (percent) =>
      onProgress?.((index + percent / 100) / queue.length, label),
    );
    if (analysis.key !== item.key) throw new Error("The clip changed while Remove Object was being analysed. Export again.");
    await saveRemovalAnalysis(item.clipId, analysis);
    done++;
  }
  if (done > 0) onProgress?.(1, "Remove Object analysed");
  return done;
}
