import type { VideoExportSettings } from "./types";

/**
 * Export queue model (Adobe Media Encoder lite). Pure state transitions: the
 * web layer owns persistence and the runner owns the actual encode.
 *
 * Every job carries a snapshot of the project taken when it was enqueued
 * (held by the runtime, not in this state), so later edits never change a
 * queued job.
 */
export type ExportJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ExportJobOutput {
  readonly filename: string;
  readonly bytes: number;
  /** Where the finished file lives: browser storage (download) or a disk path (desktop). */
  readonly storage: "browser" | "disk";
  readonly path?: string;
}

/** One WAV inside a finished stems job's archive. */
export interface ExportStemOutput {
  /** Id of the stem's source: a bus id, a track id, or an audio type. */
  readonly busId: string;
  readonly kind?: "bus" | "track" | "audioType";
  readonly name: string;
  readonly filename: string;
  readonly bytes: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationSec: number;
}

/** What a stems job renders: the selected buses (default every bus that carries signal). */
export interface StemsJobSpec {
  /** What the mix is split by; absent means buses. */
  readonly mode?: "bus" | "track" | "audioType";
  /** Source ids for `mode` (bus ids, track ids, or audio types). Falls back to `busIds`. */
  readonly ids?: readonly string[];
  readonly busIds?: readonly string[];
  readonly bitDepth: 16 | 24;
}

/** What smart rendering did for a finished job; the extra fields say how much was copied and why not more. */
export interface ExportJobSmartRender {
  readonly copiedPercent: number;
  readonly summary: string;
  readonly engine?: "webcodecs" | "native";
  readonly copiedFrames?: number;
  readonly totalFrames?: number;
  readonly copiedRuns?: number;
  /** Why nothing (or less) was stream-copied: the fall-back reasons of the plan. */
  readonly reasons?: readonly string[];
}

export interface ExportJob {
  readonly id: string;
  /** 'stems' jobs render each selected bus as a WAV and zip them; absent/'video' is the normal export. */
  readonly kind?: "video" | "stems";
  readonly stems?: StemsJobSpec;
  /** Per-stem files of a finished stems job (all inside `output`, the zip). */
  readonly stemOutputs?: readonly ExportStemOutput[];
  readonly sequenceName: string;
  readonly presetLabel: string;
  /** Output file name (with extension). */
  readonly outputName: string;
  readonly settings: VideoExportSettings;
  /** In/Out range in timeline seconds, absent for the whole sequence. */
  readonly range?: { readonly startTime: number; readonly endTime: number };
  /** Reuse matching frames from the preview render cache. */
  readonly usePreviews: boolean;
  readonly status: ExportJobStatus;
  /** 0..1 */
  readonly progress: number;
  readonly phase: string;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly elapsedMs: number;
  readonly etaMs?: number;
  readonly error?: string;
  readonly output?: ExportJobOutput;
  readonly attempts: number;
  /** Frames the export took from the render cache (when previews were used). */
  readonly framesFromCache?: number;
  readonly totalFrames?: number;
  /** Smart-render result of a finished job ("Smart render: 62% copied"). */
  readonly smartRender?: ExportJobSmartRender;
  /** Which media the export read ("Exported from full-resolution media."): never a proxy. */
  readonly sourceMedia?: string;
}

export interface ExportQueueState {
  readonly jobs: readonly ExportJob[];
  /** While paused the queue never starts a new job; a running job finishes. */
  readonly paused: boolean;
}

export const EMPTY_EXPORT_QUEUE: ExportQueueState = { jobs: [], paused: false };

export interface NewExportJob {
  readonly id: string;
  readonly kind?: "video" | "stems";
  readonly stems?: StemsJobSpec;
  readonly sequenceName: string;
  readonly presetLabel: string;
  readonly outputName: string;
  readonly settings: VideoExportSettings;
  readonly range?: { readonly startTime: number; readonly endTime: number };
  readonly usePreviews: boolean;
  readonly createdAt: number;
  readonly totalFrames?: number;
}

const TERMINAL: readonly ExportJobStatus[] = ["completed", "failed", "cancelled", "interrupted"];
export const isStemsJob = (job: Pick<ExportJob, "kind">): boolean => job.kind === "stems";
export const isTerminalJobStatus = (status: ExportJobStatus): boolean => TERMINAL.includes(status);

const patch = (
  state: ExportQueueState,
  id: string,
  update: (job: ExportJob) => ExportJob,
): ExportQueueState => {
  let changed = false;
  const jobs = state.jobs.map((job) => {
    if (job.id !== id) return job;
    const next = update(job);
    if (next !== job) changed = true;
    return next;
  });
  return changed ? { ...state, jobs } : state;
};

export function enqueueExportJob(state: ExportQueueState, input: NewExportJob): ExportQueueState {
  if (state.jobs.some((job) => job.id === input.id)) return state;
  const job: ExportJob = {
    ...input,
    status: "queued",
    progress: 0,
    phase: "Queued",
    elapsedMs: 0,
    attempts: 0,
  };
  return { ...state, jobs: [...state.jobs, job] };
}

export const runningExportJob = (state: ExportQueueState): ExportJob | undefined =>
  state.jobs.find((job) => job.status === "running");

/** The job the runner should start next, or undefined (paused, busy or nothing queued). */
export function nextRunnableJob(state: ExportQueueState): ExportJob | undefined {
  if (state.paused || runningExportJob(state)) return undefined;
  return state.jobs.find((job) => job.status === "queued");
}

export function startExportJob(state: ExportQueueState, id: string, now: number): ExportQueueState {
  if (runningExportJob(state)) return state;
  return patch(state, id, (job) =>
    job.status !== "queued"
      ? job
      : {
          ...job,
          status: "running",
          progress: 0,
          phase: "Preparing",
          startedAt: now,
          finishedAt: undefined,
          elapsedMs: 0,
          etaMs: undefined,
          error: undefined,
          attempts: job.attempts + 1,
        },
  );
}

/** ETA from the observed rate; undefined until there is enough progress to extrapolate. */
export function estimateEtaMs(elapsedMs: number, progress: number): number | undefined {
  if (!(progress > 0.02) || !(elapsedMs > 0) || progress >= 1) return undefined;
  return Math.round((elapsedMs * (1 - progress)) / progress);
}

export function reportExportProgress(
  state: ExportQueueState,
  id: string,
  progress: number,
  phase: string,
  now: number,
  /** ETA from a ProgressEstimator (null = not known yet); omitted falls back to the naive extrapolation. */
  etaMs?: number | null,
): ExportQueueState {
  return patch(state, id, (job) => {
    if (job.status !== "running") return job;
    const clamped = Math.min(1, Math.max(job.progress, Number.isFinite(progress) ? progress : 0));
    const elapsedMs = Math.max(0, now - (job.startedAt ?? now));
    const eta = etaMs === undefined ? estimateEtaMs(elapsedMs, clamped) : (etaMs ?? undefined);
    return { ...job, progress: clamped, phase, elapsedMs, etaMs: eta };
  });
}

/** A re-run of the same job (same attempt owner) starts from zero: progress, ETA and phase of the failed attempt are dropped. */
export function resetExportProgress(state: ExportQueueState, id: string, now?: number): ExportQueueState {
  return patch(state, id, (job) =>
    job.status !== "running"
      ? job
      : { ...job, progress: 0, phase: "Preparing", elapsedMs: 0, etaMs: undefined, ...(now === undefined ? {} : { startedAt: now }) },
  );
}

export function completeExportJob(
  state: ExportQueueState,
  id: string,
  now: number,
  result: {
    output: ExportJobOutput;
    framesFromCache?: number;
    smartRender?: ExportJobSmartRender;
    sourceMedia?: string;
    stemOutputs?: readonly ExportStemOutput[];
  },
): ExportQueueState {
  return patch(state, id, (job) =>
    job.status !== "running"
      ? job
      : {
          ...job,
          status: "completed",
          progress: 1,
          phase: "Complete",
          finishedAt: now,
          elapsedMs: Math.max(0, now - (job.startedAt ?? now)),
          etaMs: undefined,
          output: result.output,
          framesFromCache: result.framesFromCache,
          smartRender: result.smartRender,
          sourceMedia: result.sourceMedia,
          stemOutputs: result.stemOutputs,
        },
  );
}

export function failExportJob(state: ExportQueueState, id: string, now: number, error: string): ExportQueueState {
  return patch(state, id, (job) =>
    job.status !== "running" && job.status !== "queued"
      ? job
      : {
          ...job,
          status: "failed",
          phase: "Failed",
          finishedAt: now,
          elapsedMs: job.startedAt ? Math.max(0, now - job.startedAt) : 0,
          etaMs: undefined,
          error,
        },
  );
}

/** Cancel a queued or running job. The runner must also abort a running encode. */
export function cancelExportJob(state: ExportQueueState, id: string, now: number): ExportQueueState {
  return patch(state, id, (job) =>
    job.status !== "queued" && job.status !== "running"
      ? job
      : {
          ...job,
          status: "cancelled",
          phase: "Cancelled",
          finishedAt: now,
          elapsedMs: job.startedAt ? Math.max(0, now - job.startedAt) : 0,
          etaMs: undefined,
        },
  );
}

/** Put a failed, cancelled or interrupted job back at the end of the line. */
export function retryExportJob(state: ExportQueueState, id: string): ExportQueueState {
  const target = state.jobs.find((job) => job.id === id);
  if (!target || !["failed", "cancelled", "interrupted"].includes(target.status)) return state;
  const reset: ExportJob = {
    ...target,
    status: "queued",
    progress: 0,
    phase: "Queued",
    elapsedMs: 0,
    etaMs: undefined,
    error: undefined,
    startedAt: undefined,
    finishedAt: undefined,
    output: undefined,
    framesFromCache: undefined,
    smartRender: undefined,
    sourceMedia: undefined,
    stemOutputs: undefined,
  };
  return { ...state, jobs: [...state.jobs.filter((job) => job.id !== id), reset] };
}

export function removeExportJob(state: ExportQueueState, id: string): ExportQueueState {
  const target = state.jobs.find((job) => job.id === id);
  if (!target || target.status === "running") return state;
  return { ...state, jobs: state.jobs.filter((job) => job.id !== id) };
}

export function clearFinishedExportJobs(state: ExportQueueState): ExportQueueState {
  return { ...state, jobs: state.jobs.filter((job) => !isTerminalJobStatus(job.status)) };
}

/**
 * Reorder among the queued jobs. `toIndex` is the position among queued jobs
 * (0 = next to run); running and finished jobs keep their place.
 */
export function moveExportJob(state: ExportQueueState, id: string, toIndex: number): ExportQueueState {
  const queued = state.jobs.filter((job) => job.status === "queued");
  const from = queued.findIndex((job) => job.id === id);
  if (from < 0) return state;
  const to = Math.min(queued.length - 1, Math.max(0, Math.trunc(toIndex)));
  if (to === from) return state;
  const reordered = queued.slice();
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  let cursor = 0;
  const jobs = state.jobs.map((job) => (job.status === "queued" ? reordered[cursor++] : job));
  return { ...state, jobs };
}

export function setExportQueuePaused(state: ExportQueueState, paused: boolean): ExportQueueState {
  return state.paused === paused ? state : { ...state, paused };
}

/**
 * State read back after a reload: whatever was running was cut off, so it is
 * 'interrupted' (retryable). The queue comes back paused so nothing starts
 * until the user chooses to.
 */
export function hydrateExportQueue(state: ExportQueueState, now: number): ExportQueueState {
  const jobs = state.jobs.map((job): ExportJob =>
    job.status === "running"
      ? {
          ...job,
          status: "interrupted",
          phase: "Interrupted",
          finishedAt: now,
          etaMs: undefined,
          error: "The editor was closed or reloaded while this export was running.",
        }
      : job,
  );
  return { jobs, paused: jobs.some((job) => job.status === "queued") ? true : state.paused };
}

export function exportQueueSummary(state: ExportQueueState): {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
} {
  const count = (status: ExportJobStatus) => state.jobs.filter((job) => job.status === status).length;
  return {
    total: state.jobs.length,
    queued: count("queued"),
    running: count("running"),
    completed: count("completed"),
    failed: count("failed") + count("interrupted"),
  };
}
