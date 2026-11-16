import {
  analyzeProjectLoudness,
  createCachedMixdownRenderer,
  getAudioEngine,
  measureClipLoudness,
  planClipNormalization,
  resolveAudibleAudioTarget,
  type Clip,
  type ClipNormalizationPlan,
  type LoudnessAnalysis,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useLoudnessStore } from "../stores/loudness-store";

/** Offline loudness of the whole timeline mix (the export mixdown path). */
export async function analyzeTimelineLoudness(
  options: { signal?: AbortSignal; range?: { startTime: number; endTime: number } } = {},
): Promise<LoudnessAnalysis> {
  const store = useLoudnessStore.getState();
  const controller = new AbortController();
  options.signal?.addEventListener("abort", () => controller.abort());
  const project = useProjectStore.getState().getFullProject();
  store.begin(controller, project.id);
  try {
    const analysis = await analyzeProjectLoudness(project, createCachedMixdownRenderer(getAudioEngine()), {
      range: options.range,
      signal: controller.signal,
      onProgress: (fraction) => useLoudnessStore.getState().setProgress(fraction),
    });
    useLoudnessStore.getState().finish(analysis, project.id, project.timeline);
    return analysis;
  } catch (error) {
    if (controller.signal.aborted) {
      useLoudnessStore.getState().cancelled();
      throw error;
    }
    useLoudnessStore
      .getState()
      .fail(error instanceof Error ? error.message : "Loudness analysis failed.");
    throw error;
  }
}

/** Normalizing writes the clip's gain, which a locked track refuses. */
export class NormalizeLockedTrackError extends Error {
  constructor(trackName: string) {
    super(`The track "${trackName}" is locked. Unlock it to normalize loudness.`);
    this.name = "NormalizeLockedTrackError";
  }
}

function assertTargetTrackUnlocked(clipId: string): void {
  const project = useProjectStore.getState().getFullProject();
  const clip = useProjectStore.getState().getClip(clipId);
  if (!clip) return;
  const target = resolveAudibleAudioTarget(clip, project.timeline);
  const track = project.timeline.tracks.find((t) => t.id === target.trackId);
  if (track?.locked) throw new NormalizeLockedTrackError(track.name);
}

export interface ClipLoudnessResult {
  readonly clipId: string;
  readonly measured: LoudnessAnalysis;
  readonly plan: ClipNormalizationPlan;
  readonly applied: boolean;
}

/** Measure one clip's loudness (as it currently sounds) without changing it. */
export async function measureTimelineClipLoudness(clipId: string): Promise<{ clipId: string; measured: LoudnessAnalysis; source: Clip }> {
  const project = useProjectStore.getState().getFullProject();
  const clip = useProjectStore.getState().getClip(clipId);
  if (!clip) throw new Error(`Clip not found: ${clipId}`);
  const target = resolveAudibleAudioTarget(clip, project.timeline);
  // Captured before measuring, so a later edit shows up as a different object.
  const source = useProjectStore.getState().getClip(target.id) ?? target;
  const measured = await measureClipLoudness(project, target.id, createCachedMixdownRenderer(getAudioEngine()));
  return { clipId: target.id, measured, source };
}

/**
 * Measure the clip and set its gain so its integrated loudness lands on
 * `targetLufs`. One action = one undo step.
 */
export async function normalizeClipLoudness(clipId: string, targetLufs: number): Promise<ClipLoudnessResult> {
  const projectBefore = useProjectStore.getState().project.id;
  assertTargetTrackUnlocked(clipId);
  const { clipId: targetId, measured, source } = await measureTimelineClipLoudness(clipId);
  const clip = useProjectStore.getState().getClip(targetId);
  if (!clip) throw new Error(`Clip not found: ${targetId}`);
  // The measurement is of the clip as it sounded when it started. If the user
  // edited the project meanwhile, applying that gain to the new state would
  // land on the wrong loudness (and on the wrong project after a switch).
  if (
    useProjectStore.getState().project.id !== projectBefore ||
    clip !== source
  ) {
    throw new Error("The clip changed while it was being measured. Run Normalize loudness again.");
  }
  const plan = planClipNormalization(clip, measured, targetLufs);
  if (plan.silent || !plan.action) return { clipId: targetId, measured, plan, applied: false };
  const result = await useProjectStore.getState().executeAction({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...plan.action,
  });
  if (!result.success) throw new Error(result.error?.message ?? "The clip gain could not be changed.");
  return { clipId: targetId, measured, plan, applied: true };
}
