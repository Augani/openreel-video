export type TaskPriority = "hover" | "poster";

export interface QueuedTask<T> {
  /** Runs once a slot is free. `slot` is stable per concurrent lane (index into a resource pool). */
  readonly run: (slot: number) => Promise<T>;
  readonly priority: TaskPriority;
  readonly signal?: AbortSignal;
}

interface Pending {
  readonly task: QueuedTask<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly seq: number;
}

export class TaskCancelledError extends Error {
  constructor() {
    super("preview task cancelled");
    this.name = "TaskCancelledError";
  }
}

/**
 * Runs at most `concurrency` tasks at a time. Hover work always runs before
 * poster work, and each priority is FIFO. A task whose signal aborts while it
 * is still queued never starts (its promise rejects with TaskCancelledError).
 * `beforeStart` runs between a free slot and the task (the host yields to the
 * browser there so preview work never starves input).
 */
export class PriorityTaskQueue {
  private readonly pending: Pending[] = [];
  private readonly freeSlots: number[];
  private seq = 0;
  private active = 0;
  private maxActive = 0;
  private disposed = false;
  private paused = false;
  private activePosters = 0;
  private readonly maxPosters: number;

  /**
   * `maxPosterConcurrency` keeps background (poster) work to fewer lanes than hover work, so after every
   * poster render the main thread gets an idle gap (`beforeStart`) before the next one starts.
   */
  constructor(
    concurrency: number,
    private readonly beforeStart?: (priority: TaskPriority) => Promise<void>,
    maxPosterConcurrency: number = concurrency,
  ) {
    this.freeSlots = Array.from({ length: Math.max(1, concurrency) }, (_, index) => index);
    this.maxPosters = Math.max(1, maxPosterConcurrency);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Stops starting new tasks (running ones finish). Used while the playhead is being scrubbed or played. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.pump();
  }

  get queued(): number {
    return this.pending.length;
  }

  get running(): number {
    return this.active;
  }

  /** High-water mark of simultaneously running tasks (used by tests to prove the limit). */
  get peakRunning(): number {
    return this.maxActive;
  }

  enqueue<T>(task: QueuedTask<T>): Promise<T> {
    if (this.disposed || task.signal?.aborted) return Promise.reject(new TaskCancelledError());
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = {
        task: task as QueuedTask<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        seq: this.seq++,
      };
      this.pending.push(pending);
      task.signal?.addEventListener(
        "abort",
        () => {
          const index = this.pending.indexOf(pending);
          if (index >= 0) {
            this.pending.splice(index, 1);
            reject(new TaskCancelledError());
          }
        },
        { once: true },
      );
      this.pump();
    });
  }

  /** Rejects everything still queued; running tasks finish on their own. */
  dispose(): void {
    this.disposed = true;
    for (const pending of this.pending.splice(0)) pending.reject(new TaskCancelledError());
  }

  private next(): Pending | undefined {
    let bestIndex = -1;
    for (let index = 0; index < this.pending.length; index++) {
      const candidate = this.pending[index];
      if (candidate.task.priority === "poster" && this.activePosters >= this.maxPosters) continue;
      const best = bestIndex >= 0 ? this.pending[bestIndex] : undefined;
      if (
        !best ||
        (candidate.task.priority === "hover" && best.task.priority !== "hover")
      ) {
        bestIndex = index;
        if (candidate.task.priority === "hover") break;
      }
    }
    return bestIndex >= 0 ? this.pending.splice(bestIndex, 1)[0] : undefined;
  }

  private pump(): void {
    while (!this.paused && this.freeSlots.length > 0 && this.pending.length > 0) {
      const pending = this.next();
      if (!pending) return;
      const slot = this.freeSlots.pop() as number;
      this.active++;
      if (pending.task.priority === "poster") this.activePosters++;
      this.maxActive = Math.max(this.maxActive, this.active);
      void this.execute(pending, slot);
    }
  }

  private async execute(pending: Pending, slot: number): Promise<void> {
    try {
      await this.beforeStart?.(pending.task.priority);
      if (pending.task.signal?.aborted || this.disposed) throw new TaskCancelledError();
      pending.resolve(await pending.task.run(slot));
    } catch (error) {
      pending.reject(error);
    } finally {
      this.active--;
      if (pending.task.priority === "poster") this.activePosters--;
      this.freeSlots.push(slot);
      this.pump();
    }
  }
}

interface IdleDeadlineLike {
  timeRemaining(): number;
}

/**
 * Resolves when the main thread has a real idle period (at least `minIdleMs` left in it, no pending input),
 * or after `timeoutMs`, so queued preview work yields to input, scrubbing and playback.
 */
export function whenIdle(timeoutMs = 150, minIdleMs = 8): Promise<void> {
  return new Promise((resolve) => {
    const g = globalThis as {
      requestIdleCallback?: (cb: (deadline: IdleDeadlineLike) => void, opts?: { timeout: number }) => number;
      navigator?: { scheduling?: { isInputPending?: () => boolean } };
    };
    const started = Date.now();
    const attempt = () => {
      const idle = g.requestIdleCallback;
      if (typeof idle !== "function") {
        setTimeout(resolve, 0);
        return;
      }
      idle(
        (deadline) => {
          const waited = Date.now() - started;
          const inputPending = g.navigator?.scheduling?.isInputPending?.() ?? false;
          if ((inputPending || deadline.timeRemaining() < minIdleMs) && waited < timeoutMs) {
            setTimeout(attempt, 8);
            return;
          }
          resolve();
        },
        { timeout: Math.max(16, timeoutMs - (Date.now() - started)) },
      );
    };
    attempt();
  });
}
