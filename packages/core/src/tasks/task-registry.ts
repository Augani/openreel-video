/**
 * Unified background-task registry.
 *
 * One list for every long-running job (exports, export queue, proxies, transcription, imports,
 * analysis, tracking). It owns no work: existing job systems either mirror their state in with
 * `syncSource` (export queue, proxy cache) or wrap a run with `track` (imports, analysis). The
 * registry only presents progress and forwards pause / cancel / retry to the owning system.
 */

export type BackgroundTaskKind = "export" | "proxy" | "transcription" | "import" | "analysis" | "tracking" | "render" | "other";
export type BackgroundTaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface BackgroundTaskControls {
  readonly cancel?: () => void;
  readonly pause?: () => void;
  readonly resume?: () => void;
  readonly retry?: () => void;
}

export interface BackgroundTask {
  readonly id: string;
  readonly kind: BackgroundTaskKind;
  /** Registered system that owns the task (e.g. "export-queue"). */
  readonly source: string;
  readonly title: string;
  readonly detail?: string;
  readonly status: BackgroundTaskStatus;
  /** 0..1, or null when the owner cannot report progress (indeterminate). */
  readonly progress: number | null;
  readonly etaMs?: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly createdAt: number;
  readonly error?: string;
}

export type BackgroundTaskInput = Omit<BackgroundTask, "createdAt" | "progress"> & {
  readonly progress?: number | null;
  readonly createdAt?: number;
};

export interface BackgroundTaskView extends BackgroundTask {
  readonly can: { readonly cancel: boolean; readonly pause: boolean; readonly resume: boolean; readonly retry: boolean };
}

export interface BackgroundTaskSummary {
  readonly active: number;
  readonly running: number;
  readonly queued: number;
  readonly failed: number;
  /** Mean progress of running determinate tasks (0..1), null when none can report. */
  readonly progress: number | null;
  readonly label: string;
}

export const isActiveStatus = (status: BackgroundTaskStatus): boolean =>
  status === "queued" || status === "running" || status === "paused";

const ORDER: Record<BackgroundTaskStatus, number> = { running: 0, paused: 1, queued: 2, failed: 3, completed: 4, cancelled: 5 };
const MAX_FINISHED = 40;
const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

export interface TrackContext {
  readonly signal: AbortSignal;
  readonly id: string;
  progress(value: number | null, detail?: string): void;
}

export interface TrackOptions {
  readonly id?: string;
  readonly kind: BackgroundTaskKind;
  readonly source?: string;
  readonly title: string;
  readonly detail?: string;
  /** Provide to make the task retryable: re-runs the same work. */
  readonly retry?: () => void;
}

export class BackgroundTaskRegistry {
  private tasks = new Map<string, BackgroundTask>();
  private controls = new Map<string, BackgroundTaskControls>();
  private listeners = new Set<() => void>();
  /**
   * Finished tasks a mirrored source still lists but the user cleared (or the prune dropped). A
   * `syncSource` pass must not resurrect them; a new run under the same id (retry) lifts the mark.
   */
  private dismissed = new Set<string>();
  private snapshot: readonly BackgroundTaskView[] = [];
  private dirty = false;
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable between changes (safe for useSyncExternalStore). */
  getSnapshot = (): readonly BackgroundTaskView[] => {
    if (this.dirty) {
      this.snapshot = [...this.tasks.values()]
        .map((task): BackgroundTaskView => {
          const c = this.controls.get(task.id) ?? {};
          const active = isActiveStatus(task.status);
          return {
            ...task,
            can: {
              cancel: active && !!c.cancel,
              pause: (task.status === "running" || task.status === "queued") && !!c.pause,
              resume: task.status === "paused" && !!c.resume,
              retry: (task.status === "failed" || task.status === "cancelled") && !!c.retry,
            },
          };
        })
        .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (isActiveStatus(a.status) ? a.createdAt - b.createdAt : (b.finishedAt ?? 0) - (a.finishedAt ?? 0)));
      this.dirty = false;
    }
    return this.snapshot;
  };

  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  private changed(): void {
    this.dirty = true;
    for (const listener of [...this.listeners]) listener();
  }

  /** Add or replace one task. Terminal tasks get a finish time; the oldest finished ones are dropped. */
  upsert(input: BackgroundTaskInput, controls?: BackgroundTaskControls): void {
    const previous = this.tasks.get(input.id);
    const progress = input.progress === undefined || input.progress === null ? null : clamp01(input.progress);
    const active = isActiveStatus(input.status);
    const next: BackgroundTask = {
      ...input,
      progress,
      createdAt: input.createdAt ?? previous?.createdAt ?? this.now(),
      startedAt: input.startedAt ?? previous?.startedAt ?? (input.status === "running" ? this.now() : undefined),
      finishedAt: active ? undefined : (input.finishedAt ?? previous?.finishedAt ?? this.now()),
    };
    this.tasks.set(input.id, next);
    if (active) this.forget(input.id);
    if (controls) this.controls.set(input.id, controls);
    this.prune();
    this.changed();
  }

  remove(id: string): void {
    if (!this.tasks.delete(id)) return;
    this.controls.delete(id);
    this.changed();
  }

  /**
   * Replace every task owned by `source` (adapter for systems that keep their own state). Tasks the
   * source no longer lists disappear; unchanged ones keep their identity so listeners stay quiet.
   */
  syncSource(source: string, items: readonly { task: BackgroundTaskInput; controls?: BackgroundTaskControls }[]): void {
    const keep = new Set(items.map((item) => item.task.id));
    let touched = false;
    for (const [id, task] of this.tasks) {
      if (task.source === source && !keep.has(id)) {
        this.tasks.delete(id);
        this.controls.delete(id);
        touched = true;
      }
    }
    for (const id of this.dismissed) if (id.length && !keep.has(id) && this.dismissedSource.get(id) === source) this.forget(id);
    for (const { task, controls } of items) {
      if (this.dismissed.has(task.id)) {
        if (!isActiveStatus(task.status)) continue;
        this.forget(task.id);
      }
      const previous = this.tasks.get(task.id);
      const progress = task.progress === undefined ? null : task.progress === null ? null : clamp01(task.progress);
      if (
        previous && previous.status === task.status && previous.progress === progress && previous.title === task.title &&
        previous.detail === task.detail && previous.etaMs === task.etaMs && previous.error === task.error && previous.source === task.source
      ) {
        if (controls) this.controls.set(task.id, controls);
        continue;
      }
      const active = isActiveStatus(task.status);
      this.tasks.set(task.id, {
        ...task,
        progress,
        createdAt: task.createdAt ?? previous?.createdAt ?? this.now(),
        startedAt: task.startedAt ?? previous?.startedAt ?? (task.status === "running" ? this.now() : undefined),
        finishedAt: active ? undefined : (task.finishedAt ?? previous?.finishedAt ?? this.now()),
      });
      if (controls) this.controls.set(task.id, controls);
      touched = true;
    }
    if (touched) {
      this.prune();
      this.changed();
    }
  }

  /**
   * Run `work` as a tracked task. Cancel aborts `ctx.signal`; the work decides how to unwind.
   * An aborted run ends "cancelled", a thrown error "failed" (retryable when `retry` is given).
   */
  async track<T>(options: TrackOptions, work: (ctx: TrackContext) => Promise<T>): Promise<T> {
    const id = options.id ?? `task-${this.now()}-${++this.seq}`;
    const source = options.source ?? options.kind;
    const abort = new AbortController();
    const base = { id, kind: options.kind, source, title: options.title };
    const controls: BackgroundTaskControls = { cancel: () => abort.abort(), retry: options.retry };
    let detail = options.detail;
    this.upsert({ ...base, detail, status: "running", progress: null }, controls);
    const ctx: TrackContext = {
      id,
      signal: abort.signal,
      progress: (value, next) => {
        if (abort.signal.aborted) return;
        if (next !== undefined) detail = next;
        const current = this.tasks.get(id);
        if (!current || current.status !== "running") return;
        this.upsert({ ...current, detail, progress: value });
      },
    };
    try {
      const result = await work(ctx);
      this.upsert(abort.signal.aborted ? { ...base, detail, status: "cancelled" } : { ...base, detail, status: "completed", progress: 1 });
      return result;
    } catch (error) {
      // Name check, not instanceof: a DOMException from another realm (a worker, an iframe, jsdom) is not an Error here.
      if (abort.signal.aborted || (error as { name?: unknown } | null)?.name === "AbortError") {
        this.upsert({ ...base, detail, status: "cancelled" });
      } else {
        this.upsert({ ...base, detail, status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  private dismissedSource = new Map<string, string>();
  private forget(id: string): void {
    this.dismissed.delete(id);
    this.dismissedSource.delete(id);
  }
  private dismiss(task: BackgroundTask): void {
    this.dismissed.add(task.id);
    this.dismissedSource.set(task.id, task.source);
  }

  clearFinished(): void {
    let touched = false;
    for (const [id, task] of this.tasks) {
      if (!isActiveStatus(task.status)) {
        this.dismiss(task);
        this.tasks.delete(id);
        this.controls.delete(id);
        touched = true;
      }
    }
    if (touched) this.changed();
  }

  cancel(id: string): void {
    this.controls.get(id)?.cancel?.();
  }
  pause(id: string): void {
    this.controls.get(id)?.pause?.();
  }
  resume(id: string): void {
    this.controls.get(id)?.resume?.();
  }
  retry(id: string): void {
    this.controls.get(id)?.retry?.();
  }

  private prune(): void {
    const finished = [...this.tasks.values()].filter((t) => !isActiveStatus(t.status)).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    for (const old of finished.slice(MAX_FINISHED)) {
      this.dismiss(old);
      this.tasks.delete(old.id);
      this.controls.delete(old.id);
    }
  }
}

export function summarizeTasks(tasks: readonly BackgroundTask[]): BackgroundTaskSummary {
  const running = tasks.filter((t) => t.status === "running");
  const queued = tasks.filter((t) => t.status === "queued" || t.status === "paused").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const determinate = running.filter((t) => t.progress !== null);
  const progress = determinate.length ? determinate.reduce((sum, t) => sum + (t.progress ?? 0), 0) / determinate.length : null;
  const active = running.length + queued;
  const label = active
    ? `${active} background task${active === 1 ? "" : "s"}${progress !== null ? ` · ${Math.round(progress * 100)}%` : ""}`
    : failed
      ? `${failed} task${failed === 1 ? "" : "s"} failed`
      : "No background tasks";
  return { active, running: running.length, queued, failed, progress, label };
}

/** Compact remaining-time text ("1m 20s"), empty when unknown. */
export function formatTaskEta(etaMs: number | undefined): string {
  if (etaMs === undefined || !Number.isFinite(etaMs) || etaMs <= 0) return "";
  const s = Math.max(1, Math.round(etaMs / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The app-wide singleton every job source reports into. */
export const backgroundTasks = new BackgroundTaskRegistry();
