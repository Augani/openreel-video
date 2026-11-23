import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { create } from "zustand";
import {
  DEFAULT_REDUCE_REVERB_AMOUNT,
  DEFAULT_REDUCE_REVERB_SENSITIVITY,
  ReverbCancelledError,
  findReduceReverbEffect,
  getReduceReverbParams,
  getRealtimeAudioGraph,
  planReduceReverbAction,
  sanitizeReduceReverbParams,
  type Action,
  type Clip,
  type MediaItem,
  type ReduceReverbParams,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { decodeClipAudioBuffer } from "../utils/decode-clip-audio";
import { toast } from "../stores/notification-store";
import { enhanceTargets } from "./enhance-speech";

/**
 * Reduce Reverb for dialogue clips. The edit is the clip's "reduceReverb" audio effect (Amount and Sensitivity, 0..100); adding or
 * changing it is an ordinary undoable action. The processing itself runs once per source and setting in the shared cached job (a
 * worker) that the preview and the export both use, so this service only starts that job early (on exactly the buffer the preview
 * builds: decoded and spectrally repaired; Reduce Reverb runs before Enhance Speech), reports its progress, and can cancel it.
 */

export type ReverbClipState = "idle" | "running" | "ready" | "failed";

export interface ReverbClipStatus {
  readonly state: ReverbClipState;
  readonly fraction: number;
  readonly error?: string;
  /** What the blind estimate found: the room's RT60 in seconds and how sure it is (0..1). */
  readonly rt60?: number;
  readonly confidence?: number;
}

const IDLE: ReverbClipStatus = { state: "idle", fraction: 0 };

interface ReverbStatusStore {
  readonly statuses: Readonly<Record<string, ReverbClipStatus>>;
  readonly set: (clipId: string, status: ReverbClipStatus) => void;
}

export const useReduceReverbStore = create<ReverbStatusStore>((set) => ({
  statuses: {},
  set: (clipId, status) => set((state) => ({ statuses: { ...state.statuses, [clipId]: status } })),
}));

export const useReduceReverbStatus = (clipId: string): ReverbClipStatus => useReduceReverbStore((state) => state.statuses[clipId] ?? IDLE);

const store = () => useProjectStore.getState();

const findClip = (clipId: string): Clip | undefined => {
  for (const track of store().project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
};

const findMedia = (clip: Clip): MediaItem | undefined => store().project.mediaLibrary.items.find((item) => item.id === clip.mediaId);

const taskTitle = (clipId: string): string => {
  const clip = findClip(clipId);
  const media = clip ? findMedia(clip) : undefined;
  return `Reduce Reverb${media?.name ? ` · ${media.name}` : ""}`;
};

/** Mirrors the clip's job into the unified background-task panel (the job itself is unchanged). */
function reportTask(clipId: string, status: ReverbClipStatus): void {
  const id = `reduce-reverb:${clipId}`;
  const base = { id, kind: "analysis" as const, source: "reduce-reverb", title: taskTitle(clipId) };
  if (status.state === "running") {
    backgroundTasks.upsert({ ...base, detail: "Removing late reverb", status: "running", progress: status.fraction }, { cancel: () => void cancelReverbJob(clipId) });
  } else if (status.state === "ready") {
    if (backgroundTasks.get(id)) backgroundTasks.upsert({ ...base, status: "completed", progress: 1 });
  } else if (status.state === "failed") {
    backgroundTasks.upsert({ ...base, status: "failed", error: status.error ?? "Reduce Reverb failed" }, { retry: () => void startReverbJob(clipId) });
  } else if (backgroundTasks.get(id)?.status === "running") {
    backgroundTasks.upsert({ ...base, status: "cancelled" }, { retry: () => void startReverbJob(clipId) });
  }
}

const setStatus = (clipId: string, status: ReverbClipStatus) => {
  useReduceReverbStore.getState().set(clipId, status);
  reportTask(clipId, status);
};

interface RunningJob {
  buffer: AudioBuffer | null;
  /** The cache key of the job this clip is waiting on (known once the source is decoded). */
  key: string | null;
  params: ReduceReverbParams | null;
  cancelled: boolean;
}
const running = new Map<string, RunningJob>();

/** The buffer Reduce Reverb works on for a clip: decoded and spectrally repaired, exactly like the preview and the export. */
async function reverbSource(clip: Clip): Promise<AudioBuffer | null> {
  const media = findMedia(clip);
  if (!media?.blob) return null;
  const graph = getRealtimeAudioGraph();
  const { buffer } = await decodeClipAudioBuffer(graph.getAudioContext(), media.blob, clip.audioTrackIndex ?? 0, media.metadata?.channels);
  if (!buffer) return null;
  const spectral = await graph.prepareSpectralRepair(buffer, clip.audioEffects);
  return spectral.buffer;
}

const sameSetting = (a: ReduceReverbParams | null, b: ReduceReverbParams): boolean => !!a && a.amount === b.amount && a.sensitivity === b.sensitivity;

/**
 * Starts (or joins) the shared job for the clip's current Reduce Reverb effect and reports progress. Resolves true when the result
 * is ready, false when it failed, was cancelled, was superseded by a newer setting, or there is nothing to do. A running job for an
 * older setting of the clip is cancelled (only the newest setting is worth finishing) unless another clip is still waiting on exactly
 * that source and setting: jobs are per (source, settings), so two clips of one file with different Amounts both complete.
 */
export async function startReverbJob(clipId: string): Promise<boolean> {
  const clip = findClip(clipId);
  const params = getReduceReverbParams(clip?.audioEffects);
  if (!clip || !params) return false;
  const previous = running.get(clipId);
  if (previous && sameSetting(previous.params, params)) return false;
  const job: RunningJob = { buffer: null, key: null, params, cancelled: false };
  running.set(clipId, job);
  if (previous) {
    previous.cancelled = true;
    cancelUnshared(clipId, previous);
  }
  // A superseded job must not touch the status any more: the newer one owns it.
  const report = (status: ReverbClipStatus) => {
    if (running.get(clipId) === job) setStatus(clipId, status);
  };
  report({ state: "running", fraction: 0 });
  try {
    const buffer = await reverbSource(clip);
    if (job.cancelled) {
      report(IDLE);
      return false;
    }
    if (!buffer) {
      report({ state: "failed", fraction: 0, error: "This clip has no audio to process." });
      return false;
    }
    const cache = getRealtimeAudioGraph().getReduceReverbCache();
    job.buffer = buffer;
    job.key = cache.jobKey(buffer, params);
    const result = await cache.request({ buffer, params }, { onProgress: (fraction) => report({ state: "running", fraction }) });
    if (result) {
      const status = cache.status(buffer, params);
      report({ state: "ready", fraction: 1, rt60: status.rt60, confidence: status.confidence });
      return true;
    }
    const status = cache.status(buffer, params);
    report(status.state === "failed" ? { state: "failed", fraction: 0, error: status.error } : IDLE);
    return false;
  } catch (error) {
    if (error instanceof ReverbCancelledError) report(IDLE);
    else report({ state: "failed", fraction: 0, error: error instanceof Error ? error.message : String(error) });
    return false;
  } finally {
    if (running.get(clipId) === job) running.delete(clipId);
  }
}

/** Cancels the cached job a clip's run was waiting on, unless another clip's run waits on the same source and setting. */
function cancelUnshared(clipId: string, job: RunningJob): boolean {
  if (!job.buffer || !job.params) return true;
  const shared = [...running].some(([other, candidate]) => other !== clipId && !candidate.cancelled && job.key !== null && candidate.key === job.key);
  if (shared) return true;
  return getRealtimeAudioGraph().getReduceReverbCache().cancel(job.buffer, job.params);
}

/** Cancels the running job for the clip. */
export function cancelReverbJob(clipId: string): boolean {
  const job = running.get(clipId);
  if (!job) return false;
  job.cancelled = true;
  return cancelUnshared(clipId, job);
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

export interface ReverbApplyResult {
  readonly applied: string[];
  readonly skipped: Array<{ clipId: string; reason: string }>;
}

export class ReduceReverbUnavailableError extends Error {}

const ids = () => ({ actionId: crypto.randomUUID(), effectId: `reduce-reverb-${crypto.randomUUID()}` });

/** The one-click "Audio: Reduce Reverb": adds the effect to every selected dialogue clip as ONE undo step, then starts the cached jobs. */
export async function applyReduceReverb(clipIds: readonly string[], change: { amount?: number; sensitivity?: number } = {}): Promise<ReverbApplyResult> {
  const targets = enhanceTargets(clipIds);
  if (targets.length === 0) throw new ReduceReverbUnavailableError("Select a clip with audio first.");
  const result: ReverbApplyResult = { applied: [], skipped: [] };
  await inGroup("Reduce Reverb", async () => {
    for (const clip of targets) {
      const track = store().project.timeline.tracks.find((candidate) => candidate.id === clip.trackId);
      if (track?.locked) {
        result.skipped.push({ clipId: clip.id, reason: `The track "${track.name}" is locked.` });
        continue;
      }
      if (!findMedia(clip)?.blob) {
        result.skipped.push({ clipId: clip.id, reason: "The clip has no audio to process." });
        continue;
      }
      const action = planReduceReverbAction(findClip(clip.id) ?? clip, change, ids());
      if (action) await run(action);
      result.applied.push(clip.id);
    }
  });
  for (const id of result.applied) void startReverbJob(id);
  return result;
}

/** Sets Amount and/or Sensitivity (0..100) on the clip's effect: one undoable action; the job for the new setting starts straight away. */
export async function setReduceReverb(clipId: string, change: { amount?: number; sensitivity?: number }): Promise<boolean> {
  const clip = findClip(clipId);
  if (!clip) return false;
  const action = planReduceReverbAction(clip, change, ids());
  if (!action) return true;
  await run(action);
  invalidatePreview();
  void startReverbJob(clipId);
  return true;
}

/** Removes the effect (and cancels its job if it is still running). One undoable action. */
export async function removeReduceReverb(clipId: string): Promise<boolean> {
  const clip = findClip(clipId);
  if (!clip) return false;
  cancelReverbJob(clipId);
  const action = planReduceReverbAction(clip, null, ids());
  if (action) await run(action);
  cancelReverbJob(clipId);
  setStatus(clipId, IDLE);
  invalidatePreview();
  return true;
}

/** Cancel from the progress UI: stops the job and takes the effect off again, so a clip never carries an effect that cannot play. */
export async function cancelReduceReverb(clipId: string): Promise<void> {
  await removeReduceReverb(clipId);
}

export const currentReduceReverb = (clip: Clip | undefined): ReduceReverbParams =>
  sanitizeReduceReverbParams(findReduceReverbEffect(clip)?.params ?? { amount: DEFAULT_REDUCE_REVERB_AMOUNT, sensitivity: DEFAULT_REDUCE_REVERB_SENSITIVITY });

/** The one-click command (menu bar, clip context menu): applies Reduce Reverb to the clips and reports problems as toasts. */
export function runReduceReverbCommand(clipIds: readonly string[]): Promise<void> {
  return applyReduceReverb(clipIds)
    .then((outcome) => {
      for (const skipped of outcome.skipped) toast.warning("Reduce Reverb", skipped.reason);
      if (outcome.applied.length > 0) toast.info("Reduce Reverb", outcome.applied.length === 1 ? "Removing reverb on your device. Playback continues; the result is swapped in when ready." : `Removing reverb from ${outcome.applied.length} clips on your device.`);
    })
    .catch((error: unknown) => {
      toast.warning("Reduce Reverb", error instanceof Error ? error.message : "Reduce Reverb could not be applied.");
    });
}
