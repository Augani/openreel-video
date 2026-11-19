import { create } from "zustand";
import {
  DEFAULT_VIDEO_SETTINGS,
  cancelExportJob,
  cloneProjectSnapshot,
  clearFinishedExportJobs,
  completeExportJob,
  enqueueExportJob,
  failExportJob,
  hydrateExportQueue,
  moveExportJob,
  projectForSequence,
  nextRunnableJob,
  planStems,
  type StemMode,
  isStemsJob,
  removeExportJob,
  reportExportProgress,
  resetExportProgress,
  retryExportJob,
  setExportQueuePaused,
  startExportJob,
  ProgressEstimator,
  type ExportJob,
  type ExportQueueState,
  type Project,
  type VideoExportSettings,
} from "@openreel/core";
import { useProjectStore } from "./project-store";
import { useUIStore } from "./ui-store";
import { toast } from "./notification-store";
import { extForFormat } from "../services/export-runner";
import { renderCacheService } from "../services/render-cache-service";
import { ExportJobCancelled, cancelRunningExportJob, runExportJob } from "../services/export-queue/export-queue-runner";
import { cancelRunningStemsJob, runStemsJob } from "../services/export-queue/stems-job-runner";
import { canRetryInSoftware, hardwareEncoderFailureMessage, isTransientEncoderError, runWithEncoderRetry } from "../services/export-queue/transient-encoder-error";
import { isExportQueueRunning, setExportQueueRunning } from "../services/export-queue/export-queue-activity";
import {
  deleteBrowserOutput,
  loadQueueState,
  loadSnapshot,
  pruneStorage,
  readBrowserOutput,
  saveQueueState,
  saveSnapshot,
} from "../services/export-queue/export-queue-storage";

/**
 * Export queue (Adobe Media Encoder lite).
 *
 * Snapshot semantics: enqueueing deep-copies the project as it is at that
 * moment (media blobs shared, not duplicated) and persists a copy. A queued job
 * renders that snapshot, so edits made afterwards - or to a different project -
 * do not change it. To export the new state, add a new job.
 *
 * Limit: effects, transitions and text/graphics overlays are rendered through
 * engines the editor keeps in sync with the live project. When the snapshot
 * differs visually from the live project at the moment a job starts, those
 * engines are pointed at the snapshot for the duration of the job (and back at
 * the live project afterwards); an effect/overlay edit made *during* that run
 * can still show up in the remaining frames.
 */

export interface EnqueueInput {
  readonly settings: Partial<VideoExportSettings> & Pick<VideoExportSettings, "width" | "height" | "frameRate">;
  readonly presetLabel?: string;
  readonly usePreviews?: boolean;
  readonly outputName?: string;
  /** Sequence to render (default: the active one). */
  readonly sequenceId?: string;
}

export interface EnqueueStemsInput {
  /** What to split the mix by; default buses. */
  readonly mode?: StemMode;
  /** Source ids for `mode` (bus ids, track ids or audio types); default all that carry audio. */
  readonly ids?: readonly string[];
  /** Bus ids to render (bus mode); default every bus that carries audio. */
  readonly busIds?: readonly string[];
  readonly bitDepth?: 16 | 24;
  readonly outputName?: string;
}

const STEM_NOUNS: Record<StemMode, [string, string]> = {
  bus: ["bus", "buses"],
  track: ["track", "tracks"],
  audioType: ["audio type", "audio types"],
};

/** Output extension of a job's file: stems jobs are zips. */
export const jobOutputExt = (job: ExportJob): string =>
  isStemsJob(job) ? "zip" : extForFormat(job.settings.format, job.settings.codec);

interface ExportQueueStore {
  queue: ExportQueueState;
  hydrated: boolean;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  enqueue: (input: EnqueueInput) => ExportJob | null;
  /** Queue a stems job (selected buses as WAVs in one zip). Null when there is nothing to export. */
  enqueueStems: (input?: EnqueueStemsInput) => ExportJob | null;
  start: () => void;
  pause: () => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  move: (id: string, toQueuedIndex: number) => void;
  clearFinished: () => void;
  download: (id: string) => Promise<void>;
  reveal: (id: string) => Promise<void>;
  hydrate: () => Promise<void>;
}

const snapshots = new Map<string, Project>();
const cancelRequests = new Set<string>();
let pumping = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const PROGRESS_INTERVAL_MS = 250;

export function describePreset(settings: Pick<VideoExportSettings, "width" | "height" | "frameRate" | "codec" | "format">): string {
  const res = Math.min(settings.width, settings.height) >= 2000 ? "4K" : `${Math.min(settings.width, settings.height)}p`;
  const codec = { h264: "H.264", h265: "H.265", vp8: "VP8", vp9: "VP9", av1: "AV1", prores: "ProRes", dnxhr: "DNxHR", xdcamhd422: "XDCAM HD422", avcintra100: "AVC-Intra 100" }[settings.codec] ?? settings.codec;
  return `${res} ${Math.round(settings.frameRate)}fps ${codec} ${settings.format.toUpperCase()}`;
}

const safeName = (text: string): string =>
  Array.from(text, (ch) => (ch.charCodeAt(0) < 0x20 ? " " : ch))
    .join("")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

function persistSoon(get: () => ExportQueueStore): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveQueueState(get().queue);
  }, 400);
}

function liveSnapshotIds(queue: ExportQueueState): Set<string> {
  return new Set(queue.jobs.filter((job) => job.status !== "completed").map((job) => job.id));
}

export const useExportQueueStore = create<ExportQueueStore>((set, get) => {
  const apply = (update: (state: ExportQueueState) => ExportQueueState, flush = false) => {
    const next = update(get().queue);
    if (next === get().queue) return;
    set({ queue: next });
    if (flush) {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      void saveQueueState(next);
    } else {
      persistSoon(get);
    }
  };

  const otherExportActive = (): boolean =>
    useUIStore.getState().exportState.isExporting || renderCacheService.isRenderingNow();

  async function runOne(job: ExportJob): Promise<void> {
    const startedAt = Date.now();
    apply((s) => startExportJob(s, job.id, startedAt), true);
    setExportQueueRunning(true);
    const attempt = get().queue.jobs.find((j) => j.id === job.id)?.attempts;
    // True only while this very run still owns the job: a cancel followed by a
    // retry re-queues the job (new attempt) before this run has unwound, and a
    // late outcome of the old run must not touch the retried job.
    const ownsJob = (): boolean => {
      const current = get().queue.jobs.find((j) => j.id === job.id);
      return current?.status === "running" && current.attempts === attempt;
    };
    let project = snapshots.get(job.id) ?? null;
    let lastReport = 0;
    // Wall-clock ETA that counts down, converges and stays hidden until it means something.
    let estimator = new ProgressEstimator(Date.now);
    estimator.start();
    try {
      project ??= await loadSnapshot(job.id);
      if (!project) {
        throw new Error("The project snapshot for this job is no longer available. Add the export to the queue again.");
      }
      snapshots.set(job.id, project);
      if (get().queue.jobs.find((j) => j.id === job.id)?.status !== "running") throw new ExportJobCancelled();
      const fresh = get().queue.jobs.find((j) => j.id === job.id) ?? job;
      const hooks = {
        isCancelled: () => cancelRequests.has(job.id) || get().queue.jobs.find((j) => j.id === job.id)?.status !== "running",
        onProgress: (progress: number, phase: string) => {
          const now = Date.now();
          const eta = estimator.update(progress).etaSeconds;
          if (now - lastReport < PROGRESS_INTERVAL_MS && progress < 1) return;
          lastReport = now;
          apply((s) => reportExportProgress(s, job.id, progress, phase, now, eta === null ? null : Math.round(eta * 1000)));
        },
      };
      const result = isStemsJob(fresh)
        ? { ...(await runStemsJob(fresh, project, hooks)), framesFromCache: undefined, smartRender: undefined, sourceMedia: undefined }
        : {
            // A transient encoder failure (reclaimed session, or a hardware encoder that could not be opened, as on
            // machines and VMs without a video encode accelerator) is retried once, on the software encoder.
            ...(await runWithEncoderRetry(
              (attempt) => {
                if (attempt > 1) {
                  // The re-run starts over: drop the failed attempt's progress, phase and ETA so the bar and the
                  // background-task row count up again instead of freezing at the old value.
                  estimator = new ProgressEstimator(Date.now);
                  estimator.start();
                  lastReport = 0;
                  apply((s) => resetExportProgress(s, job.id, Date.now()), true);
                }
                return runExportJob(fresh, project!, hooks, attempt === 1 ? "prefer-hardware" : "prefer-software");
              },
              { shouldRetry: () => !hooks.isCancelled() && canRetryInSoftware(fresh.settings.encoderChoice) },
            ).catch((error: unknown) => {
              // An explicit Hardware choice cannot fall back, so a re-run would repeat the failure: say so right away.
              if (!canRetryInSoftware(fresh.settings.encoderChoice) && isTransientEncoderError(error) && !hooks.isCancelled()) {
                throw new Error(hardwareEncoderFailureMessage(error));
              }
              throw error;
            })),
            stemOutputs: undefined,
          };
      if (!ownsJob()) {
        // Cancelled (or cancelled and retried) while the last frames were encoding: the file is not wanted.
        if (result.output.storage === "browser") {
          void deleteBrowserOutput(job.id, jobOutputExt(job));
        }
        return;
      }
      apply(
        (s) => completeExportJob(s, job.id, Date.now(), { output: result.output, framesFromCache: result.framesFromCache, smartRender: result.smartRender, sourceMedia: result.sourceMedia, stemOutputs: result.stemOutputs }),
        true,
      );
      snapshots.delete(job.id);
      void pruneStorage(() => liveSnapshotIds(get().queue));
      toast.success("Export finished", `${job.outputName} is ready in the export queue.`);
    } catch (error) {
      if (!ownsJob()) {
        // cancel() already settled this job; do not overwrite a retried attempt.
      } else if (error instanceof ExportJobCancelled || (error instanceof DOMException && error.name === "AbortError")) {
        apply((s) => cancelExportJob(s, job.id, Date.now()), true);
      } else {
        const message = error instanceof Error ? error.message : "Export failed";
        apply((s) => failExportJob(s, job.id, Date.now(), message), true);
        toast.error("Export failed", `${job.outputName}: ${message}`);
      }
    } finally {
      // The pump is single-flight, so a retried attempt cannot start before this run unwound.
      cancelRequests.delete(job.id);
      setExportQueueRunning(false);
    }
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const job = nextRunnableJob(get().queue);
        if (!job) return;
        if (otherExportActive()) {
          // A direct export owns the encoder; try again shortly.
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void pump();
          }, 1500);
          return;
        }
        await runOne(job);
      }
    } finally {
      pumping = false;
    }
  }

  return {
    // Jobs wait for an explicit Start so several presets can be lined up first.
    queue: { jobs: [], paused: true },
    hydrated: false,
    panelOpen: false,
    setPanelOpen: (open) => set({ panelOpen: open }),

    enqueue: (input) => {
      // The action system edits the project in place, so copy it: the job must not see later edits.
      const full = useProjectStore.getState().getFullProject();
      const chosen =
        input.sequenceId && input.sequenceId !== full.activeSequenceId
          ? projectForSequence(full, input.sequenceId)
          : full;
      if (!chosen) {
        toast.info("Nothing to export", "That sequence no longer exists.");
        return null;
      }
      const project = cloneProjectSnapshot(chosen);
      if (!((project.timeline?.duration ?? 0) > 0)) {
        toast.info("Nothing to export", "Add clips to the timeline first.");
        return null;
      }
      const settings: VideoExportSettings = {
        ...DEFAULT_VIDEO_SETTINGS,
        ...input.settings,
        audioSettings: { ...DEFAULT_VIDEO_SETTINGS.audioSettings, ...input.settings.audioSettings },
      };
      const ext = extForFormat(settings.format, settings.codec);
      const presetLabel = input.presetLabel ?? describePreset(settings);
      const chosenName =
        input.sequenceId && input.sequenceId !== full.activeSequenceId
          ? full.sequences?.find((entry) => entry.id === input.sequenceId)?.name
          : undefined;
      const base = safeName(chosenName ? `${project.name} - ${chosenName}` : project.name) || "export";
      const taken = new Set(get().queue.jobs.map((job) => job.outputName));
      let outputName = input.outputName ? `${safeName(input.outputName).replace(/\.[a-z0-9]+$/i, "")}.${ext}` : `${base} - ${safeName(presetLabel)}.${ext}`;
      for (let n = 2; taken.has(outputName); n++) outputName = outputName.replace(/(?: \(\d+\))?\.([a-z0-9]+)$/i, ` (${n}).$1`);
      const duration = project.timeline.duration;
      const range = settings.range;
      const seconds = range ? range.endTime - range.startTime : duration;
      const id = crypto.randomUUID();
      snapshots.set(id, project);
      void saveSnapshot(id, project);
      let created: ExportJob | undefined;
      apply((s) => {
        const next = enqueueExportJob(s, {
          id,
          sequenceName: input.sequenceId && input.sequenceId !== full.activeSequenceId
            ? full.sequences?.find((entry) => entry.id === input.sequenceId)?.name ?? project.name
            : full.sequences?.find((entry) => entry.id === full.activeSequenceId)?.name ?? project.name,
          presetLabel,
          outputName,
          settings: { ...settings, range: undefined },
          range,
          usePreviews: input.usePreviews ?? true,
          createdAt: Date.now(),
          totalFrames: Math.max(1, Math.ceil(seconds * settings.frameRate - 1e-7)),
        });
        created = next.jobs.find((job) => job.id === id);
        return next;
      }, true);
      // Once started the queue stays unpaused: a job added after it drained must run, not wait for a Start button that is gone.
      if (created && !get().queue.paused) void pump();
      return created ?? null;
    },

    enqueueStems: (input = {}) => {
      const full = useProjectStore.getState().getFullProject();
      const project = cloneProjectSnapshot(full);
      const mode: StemMode = input.mode ?? "bus";
      const wanted = input.ids ?? input.busIds;
      const plan = planStems(project, { mode, ids: wanted ? [...wanted] : undefined });
      if (plan.length === 0) {
        toast.info(
          "No stems to export",
          mode === "bus"
            ? "Add a bus (or the Dialogue / Music / FX preset) and route tracks into it first."
            : "No unmuted track or clip carries audio.",
        );
        return null;
      }
      const id = crypto.randomUUID();
      const taken = new Set(get().queue.jobs.map((job) => job.outputName));
      const base = safeName(`${project.name} - Stems`) || "stems";
      let outputName = input.outputName ? `${safeName(input.outputName).replace(/\.[a-z0-9]+$/i, "")}.zip` : `${base}.zip`;
      for (let n = 2; taken.has(outputName); n++) outputName = outputName.replace(/(?: \(\d+\))?\.zip$/i, ` (${n}).zip`);
      const bitDepth = input.bitDepth ?? 24;
      snapshots.set(id, project);
      void saveSnapshot(id, project);
      let created: ExportJob | undefined;
      apply((s) => {
        const next = enqueueExportJob(s, {
          id,
          kind: "stems",
          stems: { mode, ids: plan.map((item) => item.busId), ...(mode === "bus" ? { busIds: plan.map((item) => item.busId) } : {}), bitDepth },
          sequenceName: full.sequences?.find((entry) => entry.id === full.activeSequenceId)?.name ?? project.name,
          presetLabel: `Stems: ${plan.length} ${STEM_NOUNS[mode][plan.length === 1 ? 0 : 1]} · ${bitDepth}-bit WAV`,
          outputName,
          settings: { ...DEFAULT_VIDEO_SETTINGS, width: project.settings.width, height: project.settings.height, frameRate: project.settings.frameRate },
          usePreviews: false,
          createdAt: Date.now(),
        });
        created = next.jobs.find((job) => job.id === id);
        return next;
      }, true);
      // Once started the queue stays unpaused: a job added after it drained must run, not wait for a Start button that is gone.
      if (created && !get().queue.paused) void pump();
      return created ?? null;
    },

    start: () => {
      apply((s) => setExportQueuePaused(s, false), true);
      void pump();
    },
    pause: () => apply((s) => setExportQueuePaused(s, true), true),

    cancel: (id) => {
      const job = get().queue.jobs.find((j) => j.id === id);
      if (!job) return;
      if (job.status === "running") {
        cancelRequests.add(id);
        cancelRunningExportJob();
        cancelRunningStemsJob();
      }
      apply((s) => cancelExportJob(s, id, Date.now()), true);
    },

    retry: (id) => {
      apply((s) => retryExportJob(s, id), true);
      if (!get().queue.paused) void pump();
    },

    remove: (id) => {
      const job = get().queue.jobs.find((j) => j.id === id);
      if (!job || job.status === "running") return;
      snapshots.delete(id);
      if (job.output?.storage === "browser") void deleteBrowserOutput(id, jobOutputExt(job));
      apply((s) => removeExportJob(s, id), true);
      void pruneStorage(() => liveSnapshotIds(get().queue));
    },

    move: (id, toQueuedIndex) => apply((s) => moveExportJob(s, id, toQueuedIndex), true),

    clearFinished: () => {
      for (const job of get().queue.jobs) {
        if (job.status === "completed" && job.output?.storage === "browser") {
          void deleteBrowserOutput(job.id, jobOutputExt(job));
        }
      }
      apply((s) => clearFinishedExportJobs(s), true);
      void pruneStorage(() => liveSnapshotIds(get().queue));
    },

    download: async (id) => {
      const job = get().queue.jobs.find((j) => j.id === id);
      if (!job?.output) return;
      const ext = jobOutputExt(job);
      const blob = await readBrowserOutput(id, ext);
      if (!blob) {
        toast.error("File not found", "The exported file is no longer in browser storage. Retry the export.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = job.output.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },

    reveal: async (id) => {
      const job = get().queue.jobs.find((j) => j.id === id);
      const path = job?.output?.path;
      if (path && window.openreel?.fs?.revealInFolder) await window.openreel.fs.revealInFolder(path);
    },

    hydrate: async () => {
      if (get().hydrated) return;
      set({ hydrated: true });
      const stored = await loadQueueState();
      if (!stored || stored.jobs.length === 0) return;
      // Anything enqueued before the read finished stays after the restored jobs.
      const restored = hydrateExportQueue(stored, Date.now());
      const current = get().queue;
      const known = new Set(restored.jobs.map((job) => job.id));
      set({
        queue: { jobs: [...restored.jobs, ...current.jobs.filter((job) => !known.has(job.id))], paused: true },
      });
      void saveQueueState(get().queue);
    },
  };
});

export const isExportQueueBusy = (): boolean => isExportQueueRunning();

/** Start loading the persisted queue (idempotent). Call once when the editor mounts. */
export function initExportQueue(): void {
  void useExportQueueStore.getState().hydrate();
}

/** "Add to queue" from the Export dialog: enqueue, open the panel and say so. */
export function addDialogExportToQueue(
  settings: VideoExportSettings,
  meta: { presetLabel: string; usePreviews: boolean; sequenceId?: string | null },
): ExportJob | null {
  const store = useExportQueueStore.getState();
  const job = store.enqueue({
    settings,
    presetLabel: meta.presetLabel,
    usePreviews: meta.usePreviews,
    sequenceId: meta.sequenceId ?? undefined,
  });
  if (job) {
    store.setPanelOpen(true);
    toast.info("Added to export queue", `${job.outputName} will render the project as it is now.`);
  }
  return job;
}

/** "Add stems to queue" from the Export dialog: enqueue, open the panel and say so. */
export function addDialogStemsToQueue(input: EnqueueStemsInput): ExportJob | null {
  const store = useExportQueueStore.getState();
  const job = store.enqueueStems(input);
  if (job) {
    store.setPanelOpen(true);
    toast.info("Stems added to export queue", `${job.outputName} will render the project as it is now.`);
  }
  return job;
}
