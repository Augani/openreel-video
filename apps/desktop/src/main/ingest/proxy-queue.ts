import type { DesktopProxyProfile } from "../../../../../packages/core/src/types/project";

/**
 * Background proxy queue of the main process: a bounded worker pool (1 or 2 at a time) that
 * survives window reloads and app restarts. The queue owns no ffmpeg knowledge; `run` does the work.
 * Jobs are persisted after every state change (progress excluded), so a restart re-queues whatever
 * was queued or running, and a finished job stays until the renderer acknowledges it, so a proxy
 * built while the window was closed is still linked into the project later.
 */

export type ProxyJobStatus = "queued" | "running" | "done" | "failed";

export interface ProxyJobInput {
  /** Which project the job belongs to (the project id). */
  projectKey: string;
  mediaId: string;
  srcPath: string;
  /** Folder and file name of the primary output. */
  outDir: string;
  fileName: string;
  profile: DesktopProxyProfile;
  /** Also write an H.264 preview twin (ProRes proxies the renderer cannot decode). */
  previewTwin: boolean;
}

export interface ProxyJobResult {
  outPath: string;
  /** H.264 preview twin, when one was written. */
  previewPath?: string;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
  codec: string;
  fileSize: number;
}

export interface ProxyJob extends ProxyJobInput {
  id: string;
  status: ProxyJobStatus;
  /** 0..1 */
  progress: number;
  error?: string;
  result?: ProxyJobResult;
  attempts: number;
  enqueuedAt: number;
  finishedAt?: number;
}

export type ProxyQueueEvent = { type: "update"; job: ProxyJob } | { type: "removed"; id: string; projectKey: string };

export interface ProxyQueueStore {
  load(): ProxyJob[];
  save(jobs: readonly ProxyJob[]): void;
}

export interface ProxyQueueDeps {
  run(job: ProxyJob, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<ProxyJobResult>;
  store: ProxyQueueStore;
  emit?: (event: ProxyQueueEvent) => void;
  now?: () => number;
  concurrency?: number;
  /** Minimum ms between progress events of one job. */
  progressIntervalMs?: number;
}

export const jobIdFor = (projectKey: string, mediaId: string): string => `${projectKey}:${mediaId}`;
export const clampConcurrency = (value: number): 1 | 2 => (value >= 2 ? 2 : 1);

export class ProxyQueue {
  private jobs = new Map<string, ProxyJob>();
  private controllers = new Map<string, AbortController>();
  /** Aborted because the user cancelled (drop the job) rather than because the app is quitting. */
  private cancelled = new Set<string>();
  private concurrency: 1 | 2;
  private lastProgressAt = new Map<string, number>();
  private idleWaiters: Array<() => void> = [];
  private stopped = false;
  private readonly now: () => number;

  constructor(private readonly deps: ProxyQueueDeps) {
    this.concurrency = clampConcurrency(deps.concurrency ?? 1);
    this.now = deps.now ?? Date.now;
  }

  /** Load persisted jobs. Anything that was running is queued again; it restarts from the beginning. */
  restore(): void {
    for (const job of this.deps.store.load()) {
      if (job.status === "running") Object.assign(job, { status: "queued", progress: 0 });
      this.jobs.set(job.id, job);
    }
    this.persist();
    this.pump();
  }

  setConcurrency(value: number): void {
    this.concurrency = clampConcurrency(value);
    this.pump();
  }

  getConcurrency(): number {
    return this.concurrency;
  }

  /**
   * Queue jobs. A media item that is already queued or running keeps its job unless `force` is set;
   * a finished or failed job is replaced.
   */
  enqueue(inputs: readonly ProxyJobInput[], options: { force?: boolean } = {}): ProxyJob[] {
    const out: ProxyJob[] = [];
    for (const input of inputs) {
      const id = jobIdFor(input.projectKey, input.mediaId);
      const existing = this.jobs.get(id);
      if (existing && (existing.status === "queued" || existing.status === "running")) {
        if (!options.force) {
          out.push(existing);
          continue;
        }
        this.abort(id, true);
      }
      const job: ProxyJob = { ...input, id, status: "queued", progress: 0, attempts: 0, enqueuedAt: this.now() };
      this.jobs.set(id, job);
      out.push(job);
      this.emit(job);
    }
    this.persist();
    this.pump();
    return out;
  }

  /** Cancel queued or running jobs; they disappear (nothing is left on disk by a cancelled run). */
  cancel(ids: readonly string[]): void {
    for (const id of ids) {
      const job = this.jobs.get(id);
      if (!job || job.status === "done") continue;
      this.abort(id, true);
      this.remove(job);
    }
    this.persist();
    this.pump();
  }

  /** Put every failed job of a project back in the queue. */
  retryFailed(projectKey: string): ProxyJob[] {
    const retried: ProxyJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.projectKey !== projectKey || job.status !== "failed") continue;
      Object.assign(job, { status: "queued", progress: 0, error: undefined, finishedAt: undefined });
      retried.push(job);
      this.emit(job);
    }
    this.persist();
    this.pump();
    return retried;
  }

  /** The renderer has linked a finished proxy into the project; the job can go. */
  acknowledge(ids: readonly string[]): void {
    for (const id of ids) {
      const job = this.jobs.get(id);
      if (job && (job.status === "done" || job.status === "failed")) this.jobs.delete(id);
    }
    this.persist();
  }

  list(projectKey?: string): ProxyJob[] {
    return [...this.jobs.values()].filter((job) => !projectKey || job.projectKey === projectKey).map((job) => ({ ...job }));
  }

  /** Resolves when nothing is queued or running. */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Quit: stop ffmpeg, keep the interrupted jobs queued on disk for the next launch. */
  shutdown(): void {
    this.stopped = true;
    for (const controller of this.controllers.values()) controller.abort();
    for (const job of this.jobs.values()) if (job.status === "running") Object.assign(job, { status: "queued", progress: 0 });
    this.persist();
  }

  private isIdle(): boolean {
    for (const job of this.jobs.values()) if (job.status === "queued" || job.status === "running") return false;
    return true;
  }

  private abort(id: string, userCancel: boolean): void {
    if (userCancel) this.cancelled.add(id);
    this.controllers.get(id)?.abort();
  }

  private remove(job: ProxyJob): void {
    this.jobs.delete(job.id);
    this.lastProgressAt.delete(job.id);
    this.deps.emit?.({ type: "removed", id: job.id, projectKey: job.projectKey });
    // A running job's cancellation flag is cleared when its run settles.
    if (!this.controllers.has(job.id)) this.cancelled.delete(job.id);
  }

  private emit(job: ProxyJob): void {
    this.deps.emit?.({ type: "update", job: { ...job } });
  }

  private persist(): void {
    this.deps.store.save([...this.jobs.values()].map((job) => ({ ...job })));
  }

  private pump(): void {
    if (this.stopped) return;
    for (const job of this.jobs.values()) {
      if (this.controllers.size >= this.concurrency) break;
      if (job.status !== "queued" || this.controllers.has(job.id)) continue;
      void this.start(job);
    }
    if (this.isIdle()) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  private async start(job: ProxyJob): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    job.status = "running";
    job.progress = 0;
    job.attempts += 1;
    job.error = undefined;
    this.emit(job);
    this.persist();
    const interval = this.deps.progressIntervalMs ?? 250;
    try {
      const result = await this.deps.run(
        job,
        (fraction) => {
          const at = this.now();
          const clamped = Math.max(0, Math.min(1, fraction));
          if (controller.signal.aborted || clamped === job.progress) return;
          job.progress = clamped;
          if (at - (this.lastProgressAt.get(job.id) ?? 0) >= interval || clamped >= 1) {
            this.lastProgressAt.set(job.id, at);
            this.emit(job);
          }
        },
        controller.signal,
      );
      if (this.cancelled.has(job.id)) throw new DOMException("cancelled", "AbortError");
      Object.assign(job, { status: "done", progress: 1, result, finishedAt: this.now() });
    } catch (error) {
      if (this.cancelled.has(job.id)) {
        // Dropped by cancel(): already removed (or being replaced by a forced re-queue).
        this.cancelled.delete(job.id);
        if (this.jobs.get(job.id) === job) this.remove(job);
      } else if (this.stopped || controller.signal.aborted) {
        Object.assign(job, { status: "queued", progress: 0 });
      } else {
        Object.assign(job, { status: "failed", error: error instanceof Error ? error.message : String(error), finishedAt: this.now() });
      }
    } finally {
      this.controllers.delete(job.id);
    }
    // A forced re-queue replaced this job object while it was winding down; only publish the live one.
    const finalStatus = job.status as ProxyJobStatus;
    if (this.jobs.get(job.id) === job && (finalStatus === "done" || finalStatus === "failed")) this.emit(job);
    this.persist();
    this.pump();
  }
}
