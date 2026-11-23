import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { create } from "zustand";
import {
  EnhanceCancelledError,
  findEnhanceSpeechEffect,
  getEnhanceSpeechMix,
  getRealtimeAudioGraph,
  getSharedSpectralRepairCache,
  getSpectralRepairRegions,
  planEnhanceSpeechAction,
  planEnhanceSpeechChange,
  sanitizeEnhanceBalance,
  sanitizeEnhanceMix,
  type Action,
  type Clip,
  type MediaItem,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { decodeClipAudioBuffer } from "../utils/decode-clip-audio";
import { toast } from "../stores/notification-store";
import { essentialTarget } from "./essential-sound";

/**
 * Enhance Speech for dialogue clips. The edit is the clip's "enhanceSpeech" audio effect (Mix 0..100); adding or changing it
 * is an ordinary undoable action. The model itself runs once per source in the shared cached job (a worker), which the
 * preview and the export both use, so this service only starts that job early (decoding exactly like the preview, so the
 * job is the same one), reports its progress, and can cancel it.
 */

export type EnhanceJobState = "idle" | "running" | "ready" | "failed";

export interface EnhanceClipStatus {
  readonly state: EnhanceJobState;
  /** 0..1 while running. */
  readonly fraction: number;
  readonly error?: string;
}

const IDLE: EnhanceClipStatus = { state: "idle", fraction: 0 };

interface EnhanceStatusStore {
  readonly statuses: Readonly<Record<string, EnhanceClipStatus>>;
  readonly set: (clipId: string, status: EnhanceClipStatus) => void;
}

export const useEnhanceSpeechStore = create<EnhanceStatusStore>((set) => ({
  statuses: {},
  set: (clipId, status) => set((state) => ({ statuses: { ...state.statuses, [clipId]: status } })),
}));

export const useEnhanceStatus = (clipId: string): EnhanceClipStatus => useEnhanceSpeechStore((state) => state.statuses[clipId] ?? IDLE);

const store = () => useProjectStore.getState();
const taskTitle = (clipId: string): string => {
  const clip = findClip(clipId);
  const media = clip ? findMedia(clip) : undefined;
  return `Enhance Speech${media?.name ? ` \u00b7 ${media.name}` : ""}`;
};

/** Mirrors the clip's enhance job into the unified background-task panel (the job itself is unchanged). */
function reportTask(clipId: string, status: EnhanceClipStatus): void {
  const id = `enhance-speech:${clipId}`;
  const base = { id, kind: "analysis" as const, source: "enhance-speech", title: taskTitle(clipId) };
  if (status.state === "running") {
    backgroundTasks.upsert({ ...base, detail: "Cleaning up dialogue", status: "running", progress: status.fraction }, { cancel: () => void cancelEnhanceJob(clipId) });
  } else if (status.state === "ready") {
    if (backgroundTasks.get(id)) backgroundTasks.upsert({ ...base, status: "completed", progress: 1 });
  } else if (status.state === "failed") {
    backgroundTasks.upsert({ ...base, status: "failed", error: status.error ?? "Enhance Speech failed" }, { retry: () => void startEnhanceJob(clipId) });
  } else if (backgroundTasks.get(id)?.status === "running") {
    backgroundTasks.upsert({ ...base, status: "cancelled" }, { retry: () => void startEnhanceJob(clipId) });
  }
}

const setStatus = (clipId: string, status: EnhanceClipStatus) => {
  useEnhanceSpeechStore.getState().set(clipId, status);
  reportTask(clipId, status);
};

const findClip = (clipId: string): Clip | undefined => {
  for (const track of store().project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
};

const findMedia = (clip: Clip): MediaItem | undefined => store().project.mediaLibrary.items.find((item) => item.id === clip.mediaId);

export class EnhanceSpeechUnavailableError extends Error {}

/** The clips Enhance Speech would act on for a selection (a muted video clip hands over to its linked audio clip). */
export function enhanceTargets(clipIds: readonly string[]): Clip[] {
  const seen = new Set<string>();
  const targets: Clip[] = [];
  for (const id of clipIds) {
    const target = essentialTarget(id);
    if (!target || seen.has(target.id)) continue;
    seen.add(target.id);
    targets.push(target);
  }
  return targets;
}

interface RunningJob {
  /** Null while the source is still being decoded. */
  buffer: AudioBuffer | null;
  cancelled: boolean;
}
const running = new Map<string, RunningJob>();

/**
 * The buffer the Enhance job works on for a clip: the decoded source with spectral repair and Reduce Reverb applied (Enhance
 * Speech runs after both, in the preview and the export alike). Null when the clip has no decodable audio.
 */
async function enhanceSource(clip: Clip): Promise<AudioBuffer | null> {
  const media = findMedia(clip);
  if (!media?.blob) return null;
  const graph = getRealtimeAudioGraph();
  const { buffer } = await decodeClipAudioBuffer(graph.getAudioContext(), media.blob, clip.audioTrackIndex ?? 0, media.metadata?.channels);
  if (!buffer) return null;
  const regions = getSpectralRepairRegions(clip.audioEffects);
  let source = buffer;
  if (regions.length > 0) {
    const context = graph.getAudioContext();
    const repaired = await getSharedSpectralRepairCache((channels, sampleRate) => {
      const out = context.createBuffer(channels.length, Math.max(1, channels[0]?.length ?? 1), sampleRate);
      channels.forEach((data, c) => out.getChannelData(c).set(data));
      return out;
    }).request({ buffer, regions });
    source = repaired ?? buffer;
  }
  // Reduce Reverb comes first: waits for (or starts) its job and hands over the dereverberated source.
  return (await graph.prepareReduceReverb(source, clip.audioEffects)).buffer;
}

/**
 * Starts (or joins) the shared job for the clip's current Enhance Speech effect and reports progress. Resolves true when
 * the enhancement is ready, false when it failed, was cancelled, or there is nothing to do.
 */
export async function startEnhanceJob(clipId: string): Promise<boolean> {
  const clip = findClip(clipId);
  if (!clip || getEnhanceSpeechMix(clip.audioEffects) <= 0) return false;
  if (running.has(clipId)) return false;
  const job: RunningJob = { buffer: null, cancelled: false };
  running.set(clipId, job);
  setStatus(clipId, { state: "running", fraction: 0 });
  try {
    const buffer = await enhanceSource(clip);
    if (job.cancelled) {
      setStatus(clipId, IDLE);
      return false;
    }
    if (!buffer) {
      setStatus(clipId, { state: "failed", fraction: 0, error: "This clip has no audio to enhance." });
      return false;
    }
    const cache = getRealtimeAudioGraph().getEnhanceSpeechCache();
    job.buffer = buffer;
    const result = await cache.request({ buffer, mix: 100 }, { onProgress: (fraction) => setStatus(clipId, { state: "running", fraction }) });
    if (result) {
      setStatus(clipId, { state: "ready", fraction: 1 });
      return true;
    }
    const status = cache.status(buffer);
    setStatus(clipId, status.state === "failed" ? { state: "failed", fraction: 0, error: status.error } : IDLE);
    return false;
  } catch (error) {
    if (error instanceof EnhanceCancelledError) setStatus(clipId, IDLE);
    else setStatus(clipId, { state: "failed", fraction: 0, error: error instanceof Error ? error.message : String(error) });
    return false;
  } finally {
    running.delete(clipId);
  }
}

/** Cancels the running job for the clip. */
export function cancelEnhanceJob(clipId: string): boolean {
  const job = running.get(clipId);
  if (!job) return false;
  job.cancelled = true;
  return job.buffer ? getRealtimeAudioGraph().getEnhanceSpeechCache().cancel(job.buffer) : true;
}

async function run(action: Action): Promise<void> {
  const result = await store().executeAction(action);
  if (!result.success) throw new Error(result.error?.message ?? `The ${action.type} edit could not be applied.`);
}

const invalidatePreview = () => window.dispatchEvent(new CustomEvent("openreel:preview-invalidate", { detail: { audioOnly: true } }));

async function inGroup<T>(label: string, work: () => Promise<T>): Promise<T> {
  const history = store().actionExecutor.getHistory();
  store().beginHistoryGroup(label);
  try {
    return await work();
  } finally {
    if (history.getCurrentGroupId()) store().endHistoryGroup();
    invalidatePreview();
  }
}

export interface EnhanceApplyResult {
  readonly applied: string[];
  readonly skipped: Array<{ clipId: string; reason: string }>;
}

/**
 * The one-click "Audio > Enhance Speech": adds the effect (Mix 100) to every selected dialogue clip as ONE undo step,
 * then starts the cached jobs so the enhanced audio is ready for the preview (and shows progress). `mix` sets the amount.
 */
export async function applyEnhanceSpeech(clipIds: readonly string[], mix = 100): Promise<EnhanceApplyResult> {
  const targets = enhanceTargets(clipIds);
  if (targets.length === 0) throw new EnhanceSpeechUnavailableError("Select a clip with audio first.");
  const result: EnhanceApplyResult = { applied: [], skipped: [] };
  await inGroup("Enhance Speech", async () => {
    for (const clip of targets) {
      const track = store().project.timeline.tracks.find((candidate) => candidate.id === clip.trackId);
      if (track?.locked) {
        result.skipped.push({ clipId: clip.id, reason: `The track "${track.name}" is locked.` });
        continue;
      }
      if (!findMedia(clip)?.blob) {
        result.skipped.push({ clipId: clip.id, reason: "The clip has no audio to enhance." });
        continue;
      }
      const action = planEnhanceSpeechAction(findClip(clip.id) ?? clip, mix, { actionId: crypto.randomUUID(), effectId: `enhance-speech-${crypto.randomUUID()}` });
      if (action) await run(action);
      result.applied.push(clip.id);
    }
  });
  for (const id of result.applied) void startEnhanceJob(id);
  return result;
}

/** Sets Mix (0..100) on the clip's effect: one undoable action; the cached enhancement is reused, never recomputed. */
export async function setEnhanceSpeechMix(clipId: string, mix: number): Promise<boolean> {
  const clip = findClip(clipId);
  if (!clip) return false;
  const action = planEnhanceSpeechAction(clip, sanitizeEnhanceMix(mix), { actionId: crypto.randomUUID(), effectId: `enhance-speech-${crypto.randomUUID()}` });
  if (!action) return true;
  await run(action);
  invalidatePreview();
  return true;
}

/**
 * Sets the Speech / Background balance (0..100; 100 = speech only, 50 = the original mix, 0 = background only) on the clip's effect
 * (adding Enhance Speech when the clip has none): one undoable action. The cached enhancement is remixed, never recomputed.
 */
export async function setEnhanceSpeechBalance(clipId: string, balance: number): Promise<boolean> {
  const clip = findClip(clipId);
  if (!clip) return false;
  const action = planEnhanceSpeechChange(clip, { balance: sanitizeEnhanceBalance(balance) }, { actionId: crypto.randomUUID(), effectId: `enhance-speech-${crypto.randomUUID()}` });
  if (!action) return true;
  await run(action);
  invalidatePreview();
  if (!findEnhanceSpeechEffect(clip)) void startEnhanceJob(clipId);
  return true;
}

/** Removes the effect (and cancels its job if it is still running). One undoable action. */
export async function removeEnhanceSpeech(clipId: string): Promise<boolean> {
  const clip = findClip(clipId);
  if (!clip) return false;
  cancelEnhanceJob(clipId);
  const action = planEnhanceSpeechAction(clip, null, { actionId: crypto.randomUUID(), effectId: "" });
  if (action) await run(action);
  cancelEnhanceJob(clipId);
  setStatus(clipId, IDLE);
  invalidatePreview();
  return true;
}

/** Cancel from the progress UI: stops the job and takes the effect off again, so a clip never carries an effect that cannot play. */
export async function cancelEnhanceSpeech(clipId: string): Promise<void> {
  await removeEnhanceSpeech(clipId);
}

/** Before/after: with `original` the PREVIEW plays the unprocessed audio (the export is unaffected). */
export function setEnhancePreviewOriginal(clipId: string, original: boolean): boolean {
  const effect = findEnhanceSpeechEffect(findClip(clipId));
  if (!effect) return false;
  const ok = store().setAudioEffectPreviewBypass(clipId, effect.id, original);
  invalidatePreview();
  return ok;
}

export const isPreviewingOriginal = (clip: Clip | undefined): boolean => findEnhanceSpeechEffect(clip)?.metadata?.previewBypass === true;

/** The one-click command (menu bar, clip context menu): applies Enhance Speech to the clips and reports problems as toasts. */
export function runEnhanceSpeechCommand(clipIds: readonly string[]): Promise<void> {
  return applyEnhanceSpeech(clipIds)
    .then((outcome) => {
      for (const skipped of outcome.skipped) toast.warning("Enhance Speech", skipped.reason);
      if (outcome.applied.length > 0) toast.info("Enhance Speech", outcome.applied.length === 1 ? "Enhancing this clip on your device. Playback continues; the enhanced voice is swapped in when ready." : `Enhancing ${outcome.applied.length} clips on your device.`);
    })
    .catch((error: unknown) => {
      toast.warning("Enhance Speech", error instanceof Error ? error.message : "Enhance Speech could not be applied.");
    });
}
