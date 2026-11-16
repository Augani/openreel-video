import { getMediaMemoryBudget, sampleSeekAnchors, subscribeMediaMemoryBudget } from "@openreel/core";
import { SeekAnchorIndex } from "./seek-anchor-index";
import { blobIdentity } from "./scrub-frame-cache";

/** Upper bound on total anchor memory across all media (anchors are 256 px wide, ~150 KB each). */
export const SEEK_ANCHOR_BUDGET_BYTES = 48 * 1024 * 1024;

/** A 256x144 RGBA anchor. */
const TYPICAL_ANCHOR_BYTES = 256 * 144 * 4;

/**
 * Anchors one media may take: half the budget, so a second source still fits (a full 48 MB budget allows the sampler's default 150 anchors), and
 * never more than the sampler's own default. Fewer anchors per source means a longer fallback seek
 * distance, not a failure.
 */
export function maxAnchorsForBudget(budgetBytes: number): number {
  return Math.max(12, Math.min(150, Math.floor(budgetBytes / 2 / TYPICAL_ANCHOR_BYTES)));
}

function mark(name: string): void {
  try {
    performance.mark(name);
  } catch {
    // Marks are diagnostics only.
  }
}

interface Job {
  readonly blob: Blob;
  readonly controller: AbortController;
  status: "pending" | "running" | "done" | "failed";
}

/**
 * Builds and serves seek anchors for the media on the timeline. Sampling is a
 * background, abortable, gated pass: it waits until the editor is idle, runs
 * one media at a time and is dropped when the media leaves the timeline.
 */
export class SeekAnchorService {
  readonly index = new SeekAnchorIndex(Math.min(SEEK_ANCHOR_BUDGET_BYTES, getMediaMemoryBudget().seekAnchorBytes));
  private readonly jobs = new Map<number, Job>();
  private queue: number[] = [];
  private running = false;
  private sampledAny = false;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private isIdle: () => boolean = () => true;

  constructor(
    private readonly sample: typeof sampleSeekAnchors = sampleSeekAnchors,
    private readonly startDelayMs = 1200,
    /** Pause between two sources so their decoders never open back to back. */
    private readonly gapMs = 400,
  ) {
    subscribeMediaMemoryBudget((budget) => {
      this.index.setMaxBytes(Math.min(SEEK_ANCHOR_BUDGET_BYTES, budget.seekAnchorBytes));
    });
  }

  /**
   * Replace the set of blobs that should have anchors; others are released.
   *
   * `sampleFirst` makes sampling lazy: when given, only those blobs (in that order, typically the
   * sources nearest the playhead) are decoded; the rest of `blobs` keep any anchors they already
   * have but cost nothing until they become eligible. Without it every blob is sampled.
   */
  setBlobs(blobs: readonly Blob[], isIdle: () => boolean, sampleFirst?: readonly Blob[]): void {
    this.isIdle = isIdle;
    const wanted = new Set<number>();
    for (const blob of blobs) wanted.add(blobIdentity(blob));
    const eligible = sampleFirst ?? blobs;
    const eligibleIds = new Set<number>();
    for (const blob of eligible) {
      const id = blobIdentity(blob);
      if (!wanted.has(id)) continue;
      eligibleIds.add(id);
      if (!this.jobs.has(id)) {
        this.jobs.set(id, { blob, controller: new AbortController(), status: "pending" });
        this.queue.push(id);
      }
    }
    // Priority order: a source that became eligible later is not sampled ahead of one nearer the playhead.
    const order = new Map([...eligibleIds].map((id, index) => [id, index]));
    this.queue.sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
    for (const [id, job] of [...this.jobs]) {
      if (wanted.has(id)) {
        // Pending work for a source that left the sampling window is dropped, not started later.
        if (!eligibleIds.has(id) && job.status === "pending") {
          this.jobs.delete(id);
          this.queue = this.queue.filter((queued) => queued !== id);
        }
        continue;
      }
      job.controller.abort();
      this.jobs.delete(id);
      this.index.deleteBlob(id);
      this.queue = this.queue.filter((queued) => queued !== id);
    }
    if (this.queue.length > 0 && !this.running && !this.startTimer) {
      this.startTimer = setTimeout(() => {
        this.startTimer = null;
        void this.drain();
      }, this.startDelayMs);
    }
  }

  nearest(blob: Blob, time: number, maxDistance: number) {
    return this.index.nearest(blobIdentity(blob), time, maxDistance);
  }

  status(blob: Blob): Job["status"] | "unknown" {
    return this.jobs.get(blobIdentity(blob))?.status ?? "unknown";
  }

  dispose(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
    this.queue = [];
    this.index.clear();
  }

  private waitUntilIdle = async (): Promise<void> => {
    // Hold the decode back while the user is seeking/scrubbing/playing, and
    // require a short quiet period so a click never races the sampler.
    // Cheap when the editor has stayed idle; only a busy->idle transition waits.
    let waited = false;
    for (;;) {
      if (this.isIdle()) {
        if (!waited) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        waited = false;
        if (this.isIdle()) return;
      } else {
        waited = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 60));
      }
    }
  };

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const id = this.queue.shift() as number;
        const job = this.jobs.get(id);
        if (!job || job.controller.signal.aborted) continue;
        if (this.sampledAny && this.gapMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, this.gapMs));
        if (job.controller.signal.aborted || !this.jobs.has(id)) continue;
        this.sampledAny = true;
        job.status = "running";
        mark("openreel:seek-anchors:start");
        try {
          const result = await this.sample(job.blob, {
            signal: job.controller.signal,
            maxAnchors: maxAnchorsForBudget(this.index.budgetBytes),
            waitUntilIdle: this.waitUntilIdle,
            onAnchor: ({ time, bitmap }) => {
              if (job.controller.signal.aborted || !this.jobs.has(id)) bitmap.close();
              else this.index.add(id, time, bitmap);
            },
          });
          job.status = result.completed ? "done" : "failed";
          mark(`openreel:seek-anchors:${job.status}`);
        } catch (error) {
          job.status = "failed";
          console.warn("[Preview] Seek anchor sampling failed", error);
        }
      }
    } finally {
      this.running = false;
      this.sampledAny = false;
    }
  }
}

let shared: SeekAnchorService | null = null;
export function getSeekAnchorService(): SeekAnchorService {
  shared ??= new SeekAnchorService();
  return shared;
}
